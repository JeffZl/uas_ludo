import json
from typing import Dict, List, Optional, Set
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Ludo Realtime")
app.add_middleware(
	CORSMiddleware,
	allow_origins=["*"],
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)


class Connection:
	def __init__(self, websocket: WebSocket, color: Optional[str], token: Optional[str]):
		self.websocket = websocket
		self.color = color
		self.token = token


class Room:
	def __init__(self, room_id: str):
		self.id = room_id
		self.connections: Set[Connection] = set()
		# last known state snapshot (optional, forwarded from a client-authoritative game)
		self.last_state: Optional[dict] = None

	def connect(self, conn: Connection):
		self.connections.add(conn)

	def disconnect(self, conn: Connection):
		if conn in self.connections:
			self.connections.remove(conn)

	async def broadcast(self, message: dict, exclude: Optional[Connection] = None):
		data = json.dumps(message)
		for c in list(self.connections):
			if exclude and c is exclude:
				continue
			try:
				await c.websocket.send_text(data)
			except Exception:
				# drop dead connections
				self.disconnect(c)


rooms: Dict[str, Room] = {}


def get_room(room_id: str) -> Room:
	room = rooms.get(room_id)
	if not room:
		room = Room(room_id)
		rooms[room_id] = room
	return room


@app.get("/health")
async def health():
	return {"ok": True, "service": "ludo-realtime"}


@app.websocket("/ws/{room_id}")
async def ws_endpoint(websocket: WebSocket, room_id: str, color: Optional[str] = None, token: Optional[str] = None):
	await websocket.accept()
	room = get_room(room_id)
	conn = Connection(websocket, color, token)
	room.connect(conn)
	# notify join
	await room.broadcast({"type": "presence", "event": "join", "color": color}, exclude=None)
	# send current snapshot to newly connected client
	if room.last_state is not None:
		try:
			await websocket.send_text(json.dumps({"type": "state", "payload": room.last_state}))
		except Exception:
			pass
	try:
		while True:
			raw = await websocket.receive_text()
			try:
				msg = json.loads(raw)
			except Exception:
				continue
			# Expected message types from clients:
			# - {type: "action", action: "roll"|"move", payload: {...}}
			# - {type: "state", payload: {...}}  (optional: client-authoritative sync)
			mtype = msg.get("type")
			if mtype == "state":
				room.last_state = msg.get("payload")
				# broadcast snapshot to all others
				await room.broadcast({"type": "state", "payload": room.last_state}, exclude=conn)
			elif mtype == "action":
				# forward player actions to everyone else
				await room.broadcast({"type": "action", "from": conn.color, "action": msg.get("action"), "payload": msg.get("payload")}, exclude=conn)
			elif mtype == "chat":
				await room.broadcast({"type": "chat", "from": conn.color, "text": msg.get("text","")}, exclude=conn)
			else:
				# ignore unknown
				pass
	except WebSocketDisconnect:
		room.disconnect(conn)
		await room.broadcast({"type": "presence", "event": "leave", "color": conn.color}, exclude=None)
	except Exception:
		room.disconnect(conn)
		await room.broadcast({"type": "presence", "event": "leave", "color": conn.color}, exclude=None)

