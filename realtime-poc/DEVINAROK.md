# 데비나로크 room authority

Active run state and reconnect tokens are held in the room Durable Object's memory. If the object is evicted during a run, the run and its rewards are lost; a reconnect receives `{ "t": "error", "code": "room-gone" }` and must return to the inn. The server does not persist or validate save settlement. Clients settle each result idempotently with `${roomCode}:${runId}:${playerId}`.
