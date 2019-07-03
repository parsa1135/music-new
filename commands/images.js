const rp = require("request-promise");
const Discord = require("discord.js");
const path = require("path");

require("../types.js");

/**
 * @param {PassthroughType} passthrough
 */
module.exports = function(passthrough) {
	let { config, client, commands, reloader } = passthrough;
	let key = config.chewey_api_key;

	let lang = require("../modules/lang.js")(passthrough);
	reloader.useSync(path.basename(__filename), lang);

	/**
	 * @param {String} host
	 * @param {String} path
	 * @param {Discord.Message} msg
	 * @param {String} emoji
	 * @param {String} footer
	 * @returns {Promise<Discord.Message>}
	 */
	async function sendImage(host, path, msg, emoji, footer) {
		let url;
		if (host == "chewey") url = `https://api.chewey-bot.ga/${path}?auth=${key}`;
		else if (host == "nekos") url = `https://nekos.life/api/v2/img/${path}`;
		else return Promise.reject("Host provided not supported");
		let [nmsg, body] = await Promise.all([
			msg.channel.send(emoji),
			rp(url)
		]);
		let data;
		try {
			data = JSON.parse(body);
		} catch (error) { return nmsg.edit(lang.apiError(error)); }
		let img;
		if (host == "chewey") img = data.data;
		else if (host == "nekos") img = data.url;
		else img = undefined; // excuse me what
		let embed = new Discord.RichEmbed()
			.setImage(img)
			.setColor('36393E')
			.setFooter(footer)
		return nmsg.edit({embed});
	}

	Object.assign(commands, {
		"cat": {
			usage: "none",
			description: "Returns an image of a cute cat",
			aliases: ["cat"],
			category: "images",
			/**
			 * @param {Discord.Message} msg
			 */
			process: function(msg) {
				return sendImage("chewey", "cat", msg, "<a:CatLoading:426263491385622539>", "Powered by api.chewey-bot.ga");
			}
		},
		"dog": {
			usage: "none",
			description: "Returns an image of a cute doggo",
			aliases: ["dog", "doggo"],
			category: "images",
			/**
			 * @param {Discord.Message} msg
			 */
			process: function(msg) {
				return sendImage("chewey", "dog", msg, "<a:CatLoading:426263491385622539>", "Powered by api.chewey-bot.ga");
			}
		},
		"space": {
			usage: "none",
			description: "Returns an image of space",
			aliases: ["space"],
			category: "images",
			/**
			 * @param {Discord.Message} msg
			 */
			process: function(msg) {
				return sendImage("chewey", "space", msg, "<a:SpaceLoading:429061691633041419>", "Powered by api.chewey-bot.ga");
			}
		},
		"snek": {
			usage: "none",
			description: "Returns an image of a snek",
			aliases: ["snek", "snake"],
			category: "images",
			/**
			 * @param {Discord.Message} msg
			 */
			process: async function(msg) {
				return sendImage("chewey", "snake", msg, "<a:CatLoading:426263491385622539>", "Powered by api.chewey-bot.ga");
			}
		},
		"birb": {
			usage: "none",
			description: "Returns an image of a birb",
			aliases: ["birb", "bird"],
			category: "images",
			/**
			 * @param {Discord.Message} msg
			 */
			process: async function(msg) {
				return sendImage("chewey", "birb", msg, "<a:CatLoading:426263491385622539>", "Powered by api.chewey-bot.ga");
			}
		},
		"neko": {
			usage: "none",
			description: "Returns an image of a neko (ฅ’ω’ฅ)",
			aliases: ["neko"],
			category: "images",
			/**
			 * @param {Discord.Message} msg
			 */
			process: function(msg) {
				return sendImage("nekos", "neko", msg, "<a:NekoSway:461420549990776832>", "Powered by nekos.life");
			}
		}
	});
}
