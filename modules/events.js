const Discord = require("discord.js");
const path = require("path");

require("../types.js");

let lastAttemptedLogins = [];

/**
 * @param {PassthroughType} passthrough
 */
module.exports = function(passthrough) {
	let { client, config, commands, reloadEvent, reloader, reactionMenus, queueManager } = passthrough;
	let prefixes = [];
	let statusPrefix = "&";
	let starting = true;
	if (client.readyAt != null) starting = false;

	let utils = require("./utilities.js")(passthrough);
	reloader.useSync("./modules/utilities.js", utils);

	utils.addTemporaryListener(client, "message", path.basename(__filename), manageMessage);
	if (!starting) manageReady();
	else utils.addTemporaryListener(client, "ready", path.basename(__filename), manageReady);
	utils.addTemporaryListener(client, "messageReactionAdd", path.basename(__filename), reactionEvent);
	utils.addTemporaryListener(client, "messageUpdate", path.basename(__filename), (oldMessage, data) => {
		if (data.constructor.name == "Message") manageMessage(data);
		else if (data.content) {
			let channel = client.channels.get(data.channel_id);
			let message = new Discord.Message(channel, data, client);
			manageMessage(message);
		}
	});
	utils.addTemporaryListener(client, "disconnect", path.basename(__filename), (reason) => {
		if (reason) console.log(`Disconnected with ${reason.code} at ${reason.path}.`);
		if (lastAttemptedLogins.length) console.log(`Previous disconnection was ${Math.floor(Date.now()-lastAttemptedLogins.slice(-1)[0]/1000)} seconds ago.`);
		lastAttemptedLogins.push(Date.now());
		new Promise(resolve => {
			if (lastAttemptedLogins.length >= 3) {
				let oldest = lastAttemptedLogins.shift();
				let timePassed = Date.now()-oldest;
				let timeout = 30000;
				if (timePassed < timeout) return setTimeout(() => resolve(), timeout - timePassed);
			}
			return resolve()
		}).then(() => {
			client.login(config.bot_token);
		});
	});
	utils.addTemporaryListener(client, "error", path.basename(__filename), reason => {
		if (reason) console.error(reason);
	});
	utils.addTemporaryListener(process, "unhandledRejection", path.basename(__filename), reason => {
		if (reason && reason.code) {
			if ([10003, 10008, 50001, 50013].includes(reason.code)) return;
		}
		if (reason) console.error(reason);
		else console.log("There was an error but no reason");
	});
	utils.addTemporaryListener(client, "guildMemberUpdate", path.basename(__filename), async (oldMember, newMember) => {
		if (newMember.guild.id != "475599038536744960") return;
		if (!oldMember.roles.get("475599593879371796") && newMember.roles.get("475599593879371796")) {
			let row = await utils.sql.get("SELECT * FROM Premium WHERE userID =?", newMember.id);
			if (!row) await utils.sql.all("INSERT INTO Premium (userID, state) VALUES (?, ?)", [newMember.id, 1]);
			else return;
		}
		else return;
	});

	/**
	 * @param {Discord.Message} msg
	 */
	async function manageMessage(msg) {
		if (msg.author.bot) return;
		if (msg.content == `<@${client.user.id}>`.replace(" ", "") || msg.content == `<@!${client.user.id}>`.replace(" ", "")) return msg.channel.send(`Hey there! My prefix is \`${statusPrefix}\` or \`@${client.user.tag}\`. Try using \`${statusPrefix}help\` for a complete list of my commands.`);
		let prefix = prefixes.find(p => msg.content.startsWith(p));
		if (!prefix) return;
		let cmdTxt = msg.content.substring(prefix.length).split(" ")[0];
		let suffix = msg.content.substring(cmdTxt.length + prefix.length + 1);
		let cmd = commands.find(c => c.aliases.includes(cmdTxt));
		if (cmd) {
			try {
				await cmd.process(msg, suffix);
			} catch (e) {
				if (e && e.code) {
					if (e.code == 10008) return;
					if (e.code == 50013) return;
				}
				// Report to original channel
				let msgTxt = `command ${cmdTxt} failed <:rip:401656884525793291>\n`+(await utils.stringify(e));
				let embed = new Discord.RichEmbed()
				.setDescription(msgTxt)
				.setColor("dd2d2d")
				if (await utils.hasPermission(msg.author, "eval")) msg.channel.send(embed);
				else msg.channel.send(`There was an error with the command ${cmdTxt} <:rip:401656884525793291>. The developers have been notified. If you use this command again and you see this message, please allow a reasonable time frame for this to be fixed`);
				// Report to #amanda-error-log
				let reportChannel = client.channels.get("512869106089852949");
				if (reportChannel) {
					embed.setTitle("Command error occurred.");
					let details = [
						["User", msg.author.tag],
						["User ID", msg.author.id],
						["Bot", msg.author.bot ? "Yes" : "No"]
					];
					if (msg.guild) {
						details = details.concat([
							["Guild", msg.guild.name],
							["Guild ID", msg.guild.id],
							["Channel", "#"+msg.channel.name],
							["Channel ID", msg.channel.id]
						]);
					} else {
						details = details.concat([
							["DM", "Yes"]
						]);
					}
					let maxLength = details.reduce((p, c) => Math.max(p, c[0].length), 0);
					let detailsString = details.map(row =>
						"`"+row[0]+" ​".repeat(maxLength-row[0].length)+"` "+row[1] //SC: space + zwsp, wide space
					).join("\n");
					embed.addField("Details", detailsString);
					embed.addField("Message content", "```\n"+msg.content.replace(/`/g, "ˋ")+"```"); //SC: IPA modifier grave U+02CB
					reportChannel.send(embed);
				}
			}
		} else return;
	}

	async function manageReady() {
		utils.sql.all("SELECT * FROM AccountPrefixes WHERE userID = ?", [client.user.id]).then(result => {
			prefixes = result.map(r => r.prefix);
			statusPrefix = result.find(r => r.status).prefix;
			console.log("Loaded "+prefixes.length+" prefixes: "+prefixes.join(" "));
			if (starting) client.emit("prefixes", prefixes, statusPrefix)
		});
		if (starting) {
			console.log(`Successfully logged in as ${client.user.username}`);
			process.title = client.user.username;
			utils.sql.all("SELECT * FROM RestartNotify WHERE botID = ?", [client.user.id]).then(result => {
				result.forEach(row => {
					let channel = client.channels.get(row.channelID);
					if (!channel) {
						let user = client.users.get(row.mentionID);
						if (!user) console.log(`Could not notify ${row.mentionID}`);
						else user.send("Restarted! Uptime: "+process.uptime().humanize("sec"));
					} else channel.send("<@"+row.mentionID+"> Restarted! Uptime: "+process.uptime().humanize("sec"));
				});
				utils.sql.all("DELETE FROM RestartNotify WHERE botID = ?", [client.user.id]);
			});
		}
	}

	/**
	 * @param {Discord.MessageReaction} messageReaction
	 * @param {Discord.User} user
	 */
	function reactionEvent(messageReaction, user) {
		let id = messageReaction.messageID;
		let emoji = messageReaction.emoji;
		if (user.id == client.user.id) return;
		let menu = reactionMenus[id];
		if (!menu) return;
		let msg = menu.message;
		function fixEmoji(emoji) {
			if (typeof(emoji) == "object" && emoji.id !== null) emoji = emoji.name+":"+emoji.id
			return emoji
		}
		let action = menu.actions.find(a => fixEmoji(a.emoji) == fixEmoji(emoji))
		if (!action) return;
		if ((action.allowedUsers && !action.allowedUsers.includes(user.id)) || (action.deniedUsers && action.deniedUsers.includes(user.id))) {
			if (action.remove == "user") messageReaction.remove(user);
			return;
		}
		switch (action.actionType) {
		case "reply":
			msg.channel.send(user.toString()+" "+action.actionData);
			break;
		case "edit":
			msg.edit(action.actionData);
			break;
		case "js":
			action.actionData(msg, emoji, user, messageReaction, reactionMenus);
			break;
		}
		switch (action.ignore) {
		case "that":
			menu.actions.find(a => a.emoji == emoji).actionType = "none";
			break;
		case "thatTotal":
			menu.actions = menu.actions.filter(a => a.emoji != emoji);
			break;
		case "all":
			menu.actions.forEach(a => a.actionType = "none");
			break;
		case "total":
			menu.destroy(true);
			break;
		}
		switch (action.remove) {
		case "user":
			messageReaction.remove(user);
			break;
		case "bot":
			messageReaction.remove();
			break;
		case "all":
			msg.clearReactions();
			break;
		case "message":
			menu.destroy(true);
			msg.delete();
			break;
		}
	}
}
