import Gateway from "./gateway.ts";
import { EventEmitter } from "node:events";

const BASE_URL = "https://discord.com/api/v10";
const CHANNELS_ENDPOINT = `${BASE_URL}/channels`;

interface ClientConfig {
	prefix: string;
	owner: string;
	channel: string;
	guild?: string;
}

export interface SendOptions {
	channel_id?: string;
	message_id?: string;
	mention?: boolean;
	files?: Record<string, Uint8Array | string>[];
	authorization?: string;
	all?: boolean;
}

export interface ReactOptions {
	authorization?: string;
	all?: boolean;
}

export interface InteractOptions {
	button?: ComponentData;
	guild_id?: string;
	channel_id?: string;
	message_id?: string;
	session_id?: string;
	application_id?: string;
	authorization?: string;
	all?: boolean;
	id?: string;
	author?: { id: string };
	components?: ComponentRow[];
}

interface ComponentData {
	type: number;
	custom_id: string;
}

interface ComponentRow {
	components: ComponentData[];
}

export interface ClientContext {
	id?: string;
	message_id?: string;
	channel_id?: string;
	author?: { id: string };
	message_author_id?: string;
	content?: string;
	components?: ComponentRow[];
	referenced_message?: Record<string, unknown>;
	[key: string]: unknown;
	delete: () => Promise<void>;
	typing: (channel?: string) => Promise<void>;
	send: (
		content: string,
		options?: SendOptions,
	) => Promise<ClientMessage | ClientMessage[] | null>;
	reply: (
		content: string,
		options?: SendOptions,
	) => Promise<ClientMessage | ClientMessage[] | null>;
	react: (emoji?: string, options?: ReactOptions) => Promise<void>;
	unreact: (emoji?: string, options?: ReactOptions) => Promise<void>;
}

export interface ClientMessage extends ClientContext {
	edit: (content: string) => Promise<ClientMessage | null>;
}

export interface Command {
	name: string;
	aliases: string[];
	description: string;
	options: CommandOptionKey[];
	environment: unknown[];
	fn: (
		context: ClientContext,
		options: CommandOptions,
		env: unknown[],
	) => void;
}

type CommandOptionKey = keyof CommandOptions;

export interface CommandOptions {
	text: string;
	args: string[];
	all: boolean;
	reply?: ClientContext;
}

interface CommandParams {
	name: string;
	description: string;
	aliases?: string[];
	options?: CommandOptionKey[];
	fn: (
		context: ClientContext,
		options: CommandOptions,
		env: unknown[],
	) => void;
}

async function request<T = unknown>(
	url: string,
	options: RequestInit = {},
): Promise<T | null> {
	try {
		const response = await fetch(url, options);
		if (!response.ok) {
			console.error(
				`HTTP ${response.status} ${response.statusText} — ${url}`,
			);
			return null;
		}
		const text = await response.text();
		return text ? (JSON.parse(text) as T) : null;
	} catch (error) {
		console.error("Request failed:", error);
		return null;
	}
}

class Client extends EventEmitter {
	private socket: Gateway;
	private _commands = new Map<string, Command>();

	readonly commands: Command[] = [];
	readonly tokens: string[] = [];
	readonly profiles: Record<string, string>[] = [];
	readonly headers: Record<string, string> = {
		"User-Agent":
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/12.246",
	};

	public profile: Record<string, string> = {};
	public prefix: string;
	public owner: string;
	public channel: string;
	public guild: string | undefined;

	constructor(config: ClientConfig) {
		super();
		this.prefix = config.prefix;
		this.owner = config.owner;
		this.channel = config.channel;
		this.guild = config.guild;
		this.socket = new Gateway(this);
	}

	public get token(): string {
		return this.headers.Authorization;
	}

	public set token(token: string) {
		this.headers.Authorization = token;
		this.fetch_user(token).then((profile) => {
			if (profile) this.profile = profile;
		});
	}

	public get ids(): string[] {
		return this.profiles.map((p) => p.id);
	}

	private resolve_token(
		context: Record<string, unknown>,
	): string | undefined {
		return this.tokens.find((_, i) => {
			const profile = this.profiles[i];
			return (
				profile?.id === context.message_author_id ||
				(context.author as Record<string, string> | undefined)?.id ===
					profile?.id
			);
		});
	}

	public new_message(d: Record<string, unknown>): ClientMessage {
		const data = { ...d } as ClientMessage;
		const channel = data.channel_id as string;
		const token = this.resolve_token(d);
		const headers = token
			? { ...this.headers, Authorization: token }
			: this.headers;

		data.edit = async (content: string) => {
			const result = await request<Record<string, unknown>>(
				`${CHANNELS_ENDPOINT}/${channel}/messages/${data.id}`,
				{
					method: "PATCH",
					headers: { ...headers, "Content-Type": "application/json" },
					body: JSON.stringify({ content }),
				},
			);
			return result ? this.new_message(result) : null;
		};
		data.delete = () => this.delete(d);
		data.typing = (c = channel) => this.typing(c);
		data.send = (content, options = {}) =>
			this.send(content, { channel_id: channel, ...options });
		data.reply = (content, options = {}) =>
			this.send(content, {
				mention: true,
				channel_id: channel,
				message_id: (data.id ?? data.message_id) as string,
				...options,
			});
		data.react = (emoji = "✅", options = {}) =>
			this.react(d, emoji, options);
		data.unreact = (emoji = "✅", options = {}) =>
			this.unreact(d, emoji, options);

		return data;
	}

	public new_context(d: Record<string, unknown>): ClientContext {
		const data = { ...d } as ClientContext;
		const channel = data.channel_id as string;

		data.delete = () => this.delete(d);
		data.typing = (c = channel) => this.typing(c);
		data.send = (content, options = {}) =>
			this.send(content, { channel_id: channel, ...options });
		data.reply = (content, options = {}) =>
			this.send(content, {
				mention: true,
				channel_id: channel,
				message_id: (data.id ?? data.message_id) as string,
				...options,
			});
		data.react = (emoji = "✅", options = {}) =>
			this.react(d, emoji, options);
		data.unreact = (emoji = "✅", options = {}) =>
			this.unreact(d, emoji, options);

		return data;
	}

	public async typing(channel: string = this.channel): Promise<void> {
		await request(`${CHANNELS_ENDPOINT}/${channel}/typing`, {
			method: "POST",
			headers: this.headers,
		});
	}

	public async send(
		content: string,
		options: SendOptions = {},
	): Promise<ClientMessage | ClientMessage[] | null> {
		const {
			channel_id: channel = this.channel,
			message_id: replyID,
			mention,
			files,
			authorization,
			all,
		} = options;

		const body: Record<string, unknown> = { content };
		if (mention === false) body.allowed_mentions = { parse: [] };
		if (replyID) body.message_reference = { message_id: replyID };

		const form = new FormData();
		form.append("payload_json", JSON.stringify(body));

		if (files) {
			for (const file of files) {
				for (const [key, value] of Object.entries(file)) {
					form.append(key, new File([value as BlobPart], key));
				}
			}
		}

		const make_request = (token?: string) => {
			const headers = token
				? { ...this.headers, Authorization: token }
				: authorization
				? { ...this.headers, Authorization: authorization }
				: this.headers;
			return request<Record<string, unknown>>(
				`${CHANNELS_ENDPOINT}/${channel}/messages`,
				{ method: "POST", headers, body: form },
			);
		};

		if (all) {
			const results = await Promise.all(this.tokens.map(make_request));
			return results.flatMap((r) => (r ? [this.new_message(r)] : []));
		}

		const result = await make_request();
		return result ? this.new_message(result) : null;
	}

	public async delete(context: Record<string, unknown>): Promise<void> {
		const token = this.resolve_token(context);
		const headers = token
			? { ...this.headers, Authorization: token }
			: this.headers;
		const id = (context.id ?? context.message_id) as string;
		await request(
			`${CHANNELS_ENDPOINT}/${context.channel_id}/messages/${id}`,
			{ method: "DELETE", headers },
		);
	}

	public async react(
		context: Record<string, unknown>,
		emoji = "✅",
		options: ReactOptions = {},
	): Promise<void> {
		const id = (context.id ?? context.message_id) as string | undefined;
		if (!context || !id) return;

		const url =
			`${CHANNELS_ENDPOINT}/${context.channel_id}/messages/${id}/reactions/${emoji}/@me`;
		const make_request = (token?: string) => {
			const headers = token
				? { ...this.headers, Authorization: token }
				: options.authorization
				? { ...this.headers, Authorization: options.authorization }
				: this.headers;
			return request(url, { method: "PUT", headers });
		};

		await (options.all
			? Promise.all(this.tokens.map(make_request))
			: make_request());
	}

	public async unreact(
		context: Record<string, unknown>,
		emoji = "✅",
		options: ReactOptions = {},
	): Promise<void> {
		const id = (context.id ?? context.message_id) as string | undefined;
		if (!context || !id) return;

		const url =
			`${CHANNELS_ENDPOINT}/${context.channel_id}/messages/${id}/reactions/${emoji}/@me`;
		const make_request = (token?: string) => {
			const headers = token
				? { ...this.headers, Authorization: token }
				: options.authorization
				? { ...this.headers, Authorization: options.authorization }
				: this.headers;
			return request(url, { method: "DELETE", headers });
		};

		await (options.all
			? Promise.all(this.tokens.map(make_request))
			: make_request());
	}

	public async interact(
		index: number,
		context: Record<string, unknown>,
		options: InteractOptions = {},
	): Promise<void> {
		const button = options.button ??
			(context.components as ComponentRow[] | undefined)?.[0]?.components
				?.[index];
		if (!button) return;

		const payload = {
			type: 3,
			guild_id: options.guild_id,
			channel_id: options.channel_id ?? this.channel,
			message_id: options.message_id ?? options.id,
			session_id: options.session_id ?? this.socket.session_id,
			application_id: options.application_id ?? options.author?.id,
			data: {
				component_type: button.type,
				custom_id: button.custom_id,
			},
		};

		const make_request = (token?: string) => {
			const headers = token
				? { ...this.headers, Authorization: token }
				: options.authorization
				? { ...this.headers, Authorization: options.authorization }
				: this.headers;
			return request(`${BASE_URL}/interactions`, {
				method: "POST",
				headers: { ...headers, "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
		};

		await (options.all
			? Promise.all(this.tokens.map(make_request))
			: make_request());
	}

	public fetch<T = unknown>(
		endpoint: string,
		config: { method?: string; headers?: Record<string, string> } = {},
		data?: unknown,
	): Promise<T | null> {
		return request<T>(BASE_URL + endpoint, {
			method: config.method ?? "GET",
			headers: config.headers ?? this.headers,
			body: data ? JSON.stringify(data) : undefined,
		});
	}

	public async fetch_messages(
		messageID?: string,
		channel: string = this.channel,
		limit = 10,
	): Promise<Record<string, unknown>[] | Record<string, unknown> | null> {
		const result = await request<Record<string, unknown>[]>(
			`${CHANNELS_ENDPOINT}/${channel}/messages?limit=${limit}`,
			{ headers: this.headers },
		);
		if (!result) return null;
		if (!messageID) return result;
		return result.find((m) => String(m.id) === String(messageID)) ?? null;
	}

	public fetch_user(
		token: string,
	): Promise<Record<string, string> | null> {
		return request<Record<string, string>>(`${BASE_URL}/users/@me`, {
			headers: { ...this.headers, Authorization: token },
		});
	}

	public register_command(
		command: CommandParams,
	): void {
		const cmd = {
			aliases: [],
			options: [],
			environment: [],
			...command,
		};

		this._commands.set(cmd.name, cmd);
		this.commands.push(cmd);

		if (cmd.aliases) {
			for (const alias of cmd.aliases) {
				this._commands.set(alias, cmd);
			}
		}
	}

	public load_command(name: string): Command | undefined {
		return this._commands.get(name);
	}

	public execute(
		name: string,
		args: [ClientContext, CommandOptions],
	): void {
		const command = this.load_command(name);
		if (!command) return;

		let [context, options] = args;
		if (!context) context = this.new_context({ channel_id: this.channel });

		if (command.options.length) {
			for (const option of command.options) {
				const val = options?.[option];
				if (val === undefined || !String(val).length) {
					this.handle_missing_argument(option);
					return;
				}
			}
		}

		const config: CommandOptions = {
			// args: [],
			// text: "",
			// reply: this.new_context({}),
			// all: false,
			...options,
		};

		try {
			command.fn(context, config, command.environment);
		} catch (error) {
			console.error(error);
		}
	}

	public handle_missing_argument(
		option: "reply" | "args" | "text" | "all",
	): void {
		console.log(`Missing required argument: ${option}`);
	}

	public async login(token: string | string[]): Promise<void> {
		const tokens = Array.isArray(token) ? token : [token];

		const users = await Promise.all(tokens.map((t) => this.fetch_user(t)));
		const valid = users
			.map((user, i) => (user ? { user, token: tokens[i] } : null))
			.filter((
				entry,
			): entry is { user: Record<string, string>; token: string } =>
				entry !== null
			);

		if (valid.length === 0) {
			console.error("No valid tokens.");
			return;
		}

		this.token = valid[0].token;
		this.profile = valid[0].user;
		this.tokens.push(...valid.map((e) => e.token));
		this.profiles.push(...valid.map((e) => e.user));

		console.log("preparing...");
		this.socket.connect();
		console.log("listening...");
	}
}

export default Client;
