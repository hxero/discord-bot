import Client from "./client.ts";
import type { ClientContext, ClientMessage } from "./client.ts";

const sleep = (seconds = 0.00001) =>
	new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));
const linkless_embed = (url: string) => `[\ufe0f](${url})`;

const TOKENS = [
	"YOUR_BOT_TOKEN",
	"YOUR_BOT_TOKEN_1",
	// "MORE_BOT_2"
];

const client = new Client({
	prefix: ";",
	owner: "YOUR_MAIN_ID",
	channel: "THE_INIT_CHANNEL_ID",
	// guild: "THE_SERVER_ID" // ISN'T NEEDED UNLESS ON BIG COMMUNITY SERVER
});

client.on("ready", () => {
	for (const profile of client.profiles) {
		console.log(profile.username, "is ready!");
	}
});

client.on(
	"reaction",
	async (context: ClientContext, type: "add" | "remove") => {
		if (type !== "add") return;

		const is_custom =
			(context.emoji as Record<string, string | null>).id !== null;
		const emoji = is_custom
			? `${(context.emoji as Record<string, string>).name}:${
				(context.emoji as Record<string, string>).id
			}`
			: (context.emoji as Record<string, string>).name;

		switch (emoji) {
			case "❌":
			case "🗑️":
				if (
					context.user_id === client.owner &&
					client.ids.includes(context.message_author_id as string)
				) {
					await context.delete();
				}
				break;
			default:
				if (context.user_id !== client.owner) return;
				await context.react(emoji, { all: true });
				break;
		}
	},
);

client.handle_missing_argument = (option: string) => {
	switch (option) {
		case "reply":
			return void client.send(
				"This command require a reference message (reply)",
			);
		case "args":
			return void client.send("This command require an argument");
		case "text":
			return void client.send("This command require a text argument");
	}
};

client.register_command({
	name: "ping",
	description: "'get the API latency'",
	fn: async (context) => {
		const start_time = Date.now();
		const message = await context.send("Pong!") as ClientMessage;
		if (message) {
			await message.edit(`Pong! ${(Date.now() - start_time) / 1000}s`);
		}
	},
});

client.register_command({
	name: "switch",
	aliases: ["bot"],
	description: "<user> 'switches main bot'",
	options: ["text"],
	fn: async (context, options) => {
		const { text } = options;
		const index = client.profiles.findIndex((p) =>
			p.username?.toLowerCase().startsWith(text.toLowerCase())
		);

		if (index < 0) {
			return void await context.send(
				`No bot found named \`${text}\``,
			);
		}

		client.token = client.tokens[index];
		await context.send(`Switched to <@${client.profiles[index].id}>`);
	},
});

client.register_command({
	name: "say",
	description: "<text> 'says the provided text'",
	options: ["text"],
	fn: async (context, options) => {
		const { text, all } = options;
		await context.send(text, { all });
	},
});

client.register_command({
	name: "purge",
	aliases: ["deletebulk", "delbulk"],
	description: "<limit=1> 'deletes `n` amount of messages sent by the bot'",
	fn: async (context, options) => {
		const { args } = options;
		const limit = parseInt(args[0]) || 10;

		const messages = await client.fetch_messages(
			undefined,
			context.channel_id as string,
			limit * 2,
		) as Record<string, unknown>[] | null;
		if (!messages) return;

		const progress = await context.send("Deleting...") as
			| ClientMessage
			| null;
		const deletable = (messages as Record<string, unknown>[])
			.filter((m) =>
				client.ids.includes((m.author as Record<string, string>)?.id)
			)
			.map((m) => m.id as string);

		let deleted = 0;

		for (const message_id of deletable) {
			const result = await client.fetch(
				`/channels/${context.channel_id}/messages/${message_id}`,
				{ method: "DELETE" },
			);

			if (result !== null) {
				deleted++;
			} else {
				// rate-limit
				await sleep(1);
				const retry = await client.fetch(
					`/channels/${context.channel_id}/messages/${message_id}`,
					{ method: "DELETE" },
				);
				if (retry !== null) deleted++;
			}
		}

		if (progress) {
			await progress.edit(
				`Deleted \`${deleted}\` messages${
					deleted < deletable.length
						? `\nFailed to delete \`${deletable.length - deleted}\``
						: ""
				}`,
			);
			await progress.react("❌");
		}
	},
});

client.register_command({
	name: "click",
	aliases: ["interact"],
	description:
		"<button=1> <time=1> <delay=0> 'interacts with a button in the referenced message'",
	options: ["reply"],
	fn: async (context, options) => {
		const { args, reply, all } = options;
		if (!reply) {
			return void await context.reply("A referenced message is required");
		}

		if (args[0] && !Number.isInteger(Number(args[0]))) {
			return void await context.reply("Invalid first argument");
		}
		if (args[1] && !Number.isInteger(Number(args[1]))) {
			return void await context.reply("Invalid second argument");
		}
		if (args[2] && isNaN(Number(args[2]))) {
			return void await context.reply("Invalid third argument");
		}

		const button = args[0] ? parseInt(args[0]) - 1 : 0;
		const time = args[1] ? parseInt(args[1]) : 1;
		const delay = args[2] ? Number(args[2]) : 0;

		const components = reply.components as unknown[] | undefined;
		if (!components?.length) {
			return void await client.send(
				"The referenced message doesn't have any buttons",
			);
		}

		for (let i = 0; i < time; i++) {
			await client.interact(
				button,
				reply as unknown as Record<string, unknown>,
				{
					guild_id: context.guild_id as string,
					all,
				},
			);
			if (delay) await sleep(delay);
		}
	},
});

client.register_command({
	name: "react",
	description: "<emoji=✅> 'reacts to the referenced message'",
	fn: async (context, options) => {
		const { text, reply, all } = options;
		const target = reply || context;
		let emoji = text || "✅";

		const is_custom = emoji.match(/<a?:(.+):(\d+)>/);
		if (is_custom) emoji = `${is_custom[1]}:${is_custom[2]}`;

		await target.react(emoji, { all });
	},
});

client.register_command({
	name: "ghostping",
	aliases: ["mention"],
	description: "<id> 'mentions a user by id without pinging'",
	options: ["args"],
	fn: async (context, options) => {
		const { args, all } = options;
		await context.send(`<@${args[0]}>`, { mention: false, all });
	},
});

client.register_command({
	name: "emoji",
	description: "<emoji> 'converts custom emojis to downloadable files'",
	fn: async (context, options) => {
		const { text, reply } = options;
		const content = (text || "") + ((reply?.content as string) || "");
		if (!content.trim()) {
			return void await context.send("No emoji provided");
		}

		const emojis = [...content.matchAll(/<a?:(.+?):(\d+)>/g)];
		if (!emojis.length) {
			return void await context.send("Unable to fetch custom emojis");
		}

		const result = emojis
			.map((match) => {
				const is_animated = match[0].startsWith("<a");
				const url = `https://cdn.discordapp.com/emojis/${match[2]}.${
					is_animated ? "gif" : "png"
				}?size=48&animated=${is_animated}&name=${match[1]}`;
				return linkless_embed(url);
			})
			.join("");

		await context.send(result);
	},
});

client.register_command({
	name: "cmds",
	aliases: ["commands", "help"],
	description: "'lists all commands'",
	fn: async (context, _options, env) => {
		const { commands } = client;

		if (typeof env[0] === "function") {
			client.off("reaction", env[0] as (...args: unknown[]) => void);
			env.length = 0;
		}

		const PER_PAGE = 10;
		const pages: string[] = [];
		const page_count = Math.ceil(commands.length / PER_PAGE);

		let format = "";
		// let page_index = 0;

		for (let i = 0; i < commands.length; i++) {
			const command = commands[i];
			const desc = command.description;
			const params = desc.match(/<.*>/)?.[0] ?? "";
			const description = desc.slice(params.length).trim();

			if (i % PER_PAGE === 0) {
				format = `-# \`\`\`COMMANDS [${
					pages.length + 1
				}|${page_count}]\`\`\`\n\`\`\`ts`;
			}

			format += `\n> ${command.name}${
				command.aliases.length ? ` [${command.aliases.join("|")}]` : ""
			} ${params}\n\t${description}\n`;

			if ((i + 1) % PER_PAGE === 0 || i === commands.length - 1) {
				pages.push(format + "```");
			}
		}

		let response = await context.send(pages[0]) as ClientMessage | null;
		if (!response || pages.length <= 1) {
			return response && await response.react("❌");
		}

		(async () => {
			await response.react("⬅️");
			await sleep(0.1);
			await response.react("➡️");
			await sleep(0.1);
			await response.react("❌");
		})();

		let current_page = 0;

		const reaction_handler = async (ctx: ClientContext) => {
			if (
				ctx.message_id !== response!.id ||
				client.ids.includes(ctx.user_id as string)
			) return;

			const action = (ctx.emoji as Record<string, string>).name;

			switch (action) {
				case "⬅️":
					if (current_page > 0) current_page--;
					response = await response!.edit(pages[current_page]);
					break;
				case "➡️":
					if (current_page < pages.length - 1) current_page++;
					response = await response!.edit(pages[current_page]);
					break;
				case "❌":
				case "🗑️":
					client.off(
						"reaction",
						reaction_handler as (...args: unknown[]) => void,
					);
					env.length = 0;
					break;
			}
		};

		env[0] = reaction_handler;
		client.on("reaction", reaction_handler);
	},
});

client.login(TOKENS);
