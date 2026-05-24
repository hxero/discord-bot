import Client from "./client.ts";

interface Payload {
	op: number;
	d: Record<string, unknown> | number;
	s?: number;
	t?: string;
}

class Gateway {
	session_id: string;
	socket: WebSocket | undefined;
	sequence: number;
	interval: NodeJS.Timeout | undefined;
	retries: number;
	gate: string;
	client: Client;

	constructor(client: Client) {
		this.client = client;
		this.session_id = "";
		this.sequence = 0;
		this.interval = undefined;
		this.retries = 3;
		this.gate = "wss://gateway.discord.gg/?v=10&encoding=json";
		this.socket = undefined;
	}

	public connect(): void {
		this.socket = new WebSocket(this.gate);

		this.socket.addEventListener("open", () => this.identify());

		this.socket.addEventListener("message", (event: MessageEvent) => {
			const data = JSON.parse(event.data as string) as Payload;
			this.handle_message(data);
		});

		this.socket.addEventListener("close", () => {
			clearInterval(this.interval);
			if (this.retries > 0) {
				this.retries--;
				setTimeout(() => this.connect(), 5000);
			}
		});
	}

	private send(payload: Payload): void {
		if (this.socket?.readyState === WebSocket.OPEN) {
			this.socket.send(JSON.stringify(payload));
		}
	}

	private identify(): void {
		const payload: Payload = {
			op: 2,
			d: {
				token: this.client.token,
				properties: {
					os: "linux",
					browser: "firefox",
					device: "mobile",
				},
				presence: {
					status: "online",
					afk: false,
				},
			},
		};
		this.send(payload);
	}

	private heartbeat(): void {
		this.send({ op: 1, d: this.sequence });
	}

	public handle_message(message: Payload): void {
		const { op, d, s, t } = message;
		const client = this.client;
		this.sequence = s || this.sequence;

		if (typeof d !== "object") return;

		switch (op) {
			case 0: {
				const context = client.new_context(d);
				switch (t) {
					case "READY": {
						client.emit("ready", context);
						if (client.guild) {
							const payload: Payload = {
								op: 14,
								d: {
									guild_id: client.guild,
									typing: true,
									threads: false,
									activities: false,
									members: [],
									channels: { [client.channel]: [[0, 99]] },
								},
							};
							this.send(payload);
						}
						this.session_id = d.session_id as string;
						break;
					}
					case "MESSAGE_CREATE": {
						client.emit("message", context, "create");
						if (
							(d.author as Record<string, string>).id ===
								client.owner
						) {
							client.channel = d.channel_id as string;
							const reply = d.referenced_message
								? client.new_context(
									d.referenced_message as Record<
										string,
										unknown
									>,
								)
								: undefined;
							const content = (d.content as string).trim();
							if (content.startsWith(client.prefix)) {
								const args = content.split(/\s+/);
								const text = content.slice(args[0].length + 1);
								const all = content.startsWith(
									client.prefix.repeat(2),
								);
								const commandName = args.shift()?.slice(
									all
										? client.prefix.length * 2
										: client.prefix.length,
								);
								const command = commandName &&
									client.load(commandName);
								if (command) {
									client.run(commandName, [context, {
										args,
										text,
										reply,
										all,
									}]);
								}
							}
						}
						break;
					}
					case "MESSAGE_UPDATE":
						client.emit("message", context, "update");
						break;
					case "MESSAGE_DELETE":
						client.emit("message", context, "delete");
						break;
					case "MESSAGE_REACTION_ADD":
						client.emit("reaction", context, "add");
						break;
					case "MESSAGE_REACTION_REMOVE":
						client.emit("reaction", context, "remove");
						break;
				}
				break;
			}
			case 9:
				this.identify();
				break;
			case 10: {
				const { heartbeat_interval } = d as {
					heartbeat_interval: number;
				};
				this.interval = setInterval(
					() => this.heartbeat(),
					heartbeat_interval,
				);
				break;
			}
			case 11:
				break;
		}
	}
}

export default Gateway;
