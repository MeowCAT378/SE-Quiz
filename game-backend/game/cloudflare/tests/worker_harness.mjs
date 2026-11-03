// Test-only entry: deterministic delayed-alarm controls never enter the deployed bundle.
import runtime, { Game as RuntimeGame, GameManager } from "../build/index.js";
export { GameManager };
export class Game extends RuntimeGame {
	constructor(state, env) {
		super(state, env);
		this.testStorage = state.storage;
	}
	async fetch(request) {
		if (new URL(request.url).pathname === "/__test/delay-alarm") {
			await this.testStorage.setAlarm(Date.now() + 60_000);
			return new Response("delayed");
		}
		if (new URL(request.url).pathname === "/__test/remove-snapshot") {
			await this.testStorage.delete("count");
			return new Response("removed");
		}
		return super.fetch(request);
	}
}
export default runtime;
