## Ludo Multiplayer Backend

Two services:

- `server/` — Express REST API for rooms and seating
- `realtime/` — Python FastAPI WebSocket server (asyncio) for real-time game sync

### 1) Run the Express API

```bash
cd server
npm install
npm run start
```

Environment variables (optional):

- `PORT` — default `4000`
- `REALTIME_WS_URL` — default `ws://localhost:8000/ws`

Endpoints:

- `POST /rooms` → create a room `{ room, wsUrl }`
- `GET /rooms/:id` → fetch room `{ room, wsUrl }`
- `POST /rooms/:id/seat` body: `{ name, color }` → take a seat, returns `{ room, player, wsUrl }`
- `DELETE /rooms/:id/seat` body: `{ color, token }` → leave seat
- `GET /rooms` → list rooms

### 2) Run the Realtime WebSocket server

```bash
cd realtime
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

WebSocket endpoint: `ws://localhost:8000/ws/{roomId}`

### 3) Frontend wiring (example)

Use the REST API to create/join a room and receive the WebSocket URL, then connect using asyncio-compatible client or the browser `WebSocket`:

```js
// Create a room
const res = await fetch('http://localhost:4000/rooms', { method: 'POST' });
const { room, wsUrl } = await res.json();

// Seat as Blue
const seatRes = await fetch(`http://localhost:4000/rooms/${room.id}/seat`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ name: 'Player 1', color: 'blue' })
});
const seat = await seatRes.json();
const url = seat.wsUrl; // already includes ?color=blue&token=...

const ws = new WebSocket(url);
ws.onmessage = (ev) => {
	const msg = JSON.parse(ev.data);
	// handle "action", "state", "presence", "chat"
};
```

### 4) Protocol

Outbound from client:

- `{"type":"action","action":"roll","payload":{"value":6}}`
- `{"type":"action","action":"move","payload":{"pieceId":1,"to":"route","index":17}}`
- `{"type":"state","payload":{...fullGameState}}`  // optional: send authoritative snapshot after applying moves
- `{"type":"chat","text":"hello"}`

Inbound to clients (broadcasts from server):

- `{"type":"presence","event":"join","color":"blue"}` / `{"type":"presence","event":"leave","color":"blue"}`
- `{"type":"action","from":"red","action":"move","payload":{...}}`
- `{"type":"state","payload":{...fullGameState}}`
- `{"type":"chat","from":"green","text":"gg"}`


### Notes

- State authority: simplest is one client (room host) applies rules and emits `state` snapshots; other clients render and trust it. Alternatively, move validation can be moved into Python, but that requires porting the rules.


