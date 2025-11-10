import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

const PORT = process.env.PORT || 4000;
const REALTIME_WS_URL = process.env.REALTIME_WS_URL || 'ws://localhost:8000/ws';

// In-memory room store (use Redis/DB for production)
const rooms = new Map();

function createRoom() {
	const id = uuidv4().slice(0, 8);
	const room = {
		id,
		createdAt: Date.now(),
		players: {
			blue: null,
			red: null,
			yellow: null,
			green: null
		},
		status: 'open' // open | full | playing | finished
	};
	rooms.set(id, room);
	return room;
}

app.get('/health', (req, res) => {
	res.json({ ok: true, service: 'ludo-express' });
});

app.post('/rooms', (req, res) => {
	const room = createRoom();
	res.status(201).json({ room, wsUrl: `${REALTIME_WS_URL}/${room.id}` });
});

app.get('/rooms/:id', (req, res) => {
	const { id } = req.params;
	const room = rooms.get(id);
	if (!room) return res.status(404).json({ error: 'Room not found' });
	res.json({ room, wsUrl: `${REALTIME_WS_URL}/${room.id}` });
});

app.post('/rooms/:id/seat', (req, res) => {
	const { id } = req.params;
	const { name, color } = req.body || {};
	const room = rooms.get(id);
	if (!room) return res.status(404).json({ error: 'Room not found' });
	if (!['blue','red','yellow','green'].includes(color)) {
		return res.status(400).json({ error: 'Invalid color' });
	}
	if (room.players[color]) {
		return res.status(409).json({ error: 'Seat already taken' });
	}
	const token = uuidv4().replace(/-/g,'');
	room.players[color] = { name: name || color, token };
	const seatsTaken = Object.values(room.players).filter(Boolean).length;
	if (seatsTaken === 4) room.status = 'full';
	res.json({ room, player: { color, token }, wsUrl: `${REALTIME_WS_URL}/${room.id}?color=${color}&token=${token}` });
});

app.delete('/rooms/:id/seat', (req, res) => {
	const { id } = req.params;
	const { color, token } = req.body || {};
	const room = rooms.get(id);
	if (!room) return res.status(404).json({ error: 'Room not found' });
	if (!room.players[color]) return res.status(400).json({ error: 'Seat empty' });
	if (room.players[color].token !== token) return res.status(403).json({ error: 'Invalid token' });
	room.players[color] = null;
	room.status = 'open';
	res.json({ room });
});

app.get('/rooms', (req, res) => {
	const list = Array.from(rooms.values()).map(r => ({
		id: r.id,
		status: r.status,
		players: r.players
	}));
	res.json({ rooms: list });
});

app.listen(PORT, () => {
	console.log(`Express API listening on http://localhost:${PORT}`);
	console.log(`Expect realtime WebSocket at ${REALTIME_WS_URL}/{roomId}`);
});

