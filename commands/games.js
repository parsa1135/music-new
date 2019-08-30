//@ts-check

const rp = require("request-promise")
const entities = require("entities")
const Discord = require("discord.js")
const path = require("path")

const passthrough = require("../passthrough")
let { client, commands, reloader, gameStore } = passthrough

const numbers = [":one:", ":two:", ":three:", ":four:", ":five:", ":six:", ":seven:", ":eight:", ":nine:"]

/**
 * @typedef TriviaResponse
 * @property {string} category
 * @property {string} type
 * @property {string} difficulty
 * @property {string} question
 * @property {string} correct_answer
 * @property {Array<string>} incorrect_answers
 */


let utils = require("../modules/utilities.js")
reloader.useSync("./modules/utilities.js", utils)

let lang = require("../modules/lang.js")
reloader.useSync("./modules/lang.js", lang)

class Game {
	/**
	 * @param {Discord.TextChannel|Discord.DMChannel} channel
	 * @param {string} type
	 */
	constructor(channel, type) {
		this.channel = channel
		this.type = type
		this.manager = gameStore
		this.id = channel.id
		this.receivedAnswers = undefined;
		if (channel instanceof Discord.TextChannel) this.permissions = channel.permissionsFor(client.user)
		else this.permissions = undefined
	}
	init() {
		this.manager.addGame(this)
		this.start()
	}
	destroy() {
		this.manager.store.delete(this.id)
	}
	start() {
		// intentionally empty
	}
}
module.exports.Game = Game

class TriviaGame extends Game {
	/**
	 * @param {Discord.TextChannel|Discord.DMChannel} channel
	 * @param {{response_code: number, results: Array<TriviaResponse>}} data
	 * @param {number} category
	 */
	constructor(channel, data, category) {
		super(channel, "trivia")
		this.data = data.results[0]
		this.category = category
	}
	start() {
		let correctAnswer = this.data.correct_answer.trim()
		let wrongAnswers = this.data.incorrect_answers.map(a => a.trim())
		this.answers = wrongAnswers
			.map(answer => ({ correct: false, answer }))
			.concat([{ correct: true, answer: correctAnswer }])
		utils.arrayShuffle(this.answers)
		this.answers = this.answers.map((answer, index) => Object.assign(answer, {letter: Buffer.from([0xf0, 0x9f, 0x85, 0x90+index]).toString()}))
		this.correctAnswer = entities.decodeHTML(correctAnswer)
		// Answer Fields
		let answerFields = [[], []]
		this.answers.forEach((answer, index) => answerFields[index < this.answers.length/2 ? 0 : 1].push(answer))
		// Difficulty
		this.difficulty = this.data.difficulty
		this.color =
				this.difficulty == "easy"
			? 0x1ddd1d
			: this.difficulty == "medium"
			? 0xC0C000
			: this.difficulty == "hard"
			? 0xdd1d1d
			: 0x3498DB
		// Send Message
		let embed = new Discord.MessageEmbed()
			.setTitle(`${entities.decodeHTML(this.data.category)} (${this.data.difficulty})`)
			.setDescription("​\n"+entities.decodeHTML(this.data.question))
			.setColor(this.color)
		answerFields.forEach(f => embed.addField("​", f.map(a => `${a.letter} ${entities.decodeHTML(a.answer)} \n`).join("")+"​", true)) //SC: zero-width space and em space
		embed.setFooter("To answer, type a letter in chat. You have 20 seconds.")
		this.channel.send(utils.contentify(this.channel, embed))
		// Setup timer
		this.timer = setTimeout(() => this.end(), 20000)
		// Prepare to receive answers
		/**
		 * Map a userID to an answer index (A = 0, B = 1, C = 2, D = 3)
		 * @type {Map<string, number>}
		 */
		this.receivedAnswers = new Map()
	}
	/**
	 * @param {Discord.Message} msg
	 */
	addAnswer(msg) {
		// Check answer is a single letter
		if (msg.content.length != 1) return
		// Get answer index
		let index = msg.content.toUpperCase().charCodeAt(0)-65
		// Check answer is within range
		if (!this.answers[index]) return
		// Add to received answers
		this.receivedAnswers.set(msg.author.id, index)
		//msg.channel.send(`Added answer: ${msg.author.username}, ${index}`)
	}
	async end() {
		// Clean up
		clearTimeout(this.timer)
		this.manager.gamesPlayed++
		this.destroy()
		// Check answers
		let coins =
			this.difficulty == "easy"
			? 150
			: this.difficulty == "medium"
			? 250
			: this.difficulty == "hard"
			? 500
			: 0 // excuse me what the fuck
		// Award coins
		const cooldownInfo = {
			max: 10,
			min: 2,
			step: 1,
			regen: {
				amount: 1,
				time: 30*60*1000
			}
		}
		let winners = [...this.receivedAnswers.entries()].filter(r => this.answers[r[1]].correct)
		let results = await Promise.all(winners.map(async w => {
			let result = {}
			result.userID = w[0]
			let cooldownValue = await utils.cooldownManager(w[0], "trivia", cooldownInfo)
			result.winnings = Math.floor(coins * 0.8 ** (10-cooldownValue))
			//result.text = `${coins} × 0.8^${(10-cooldownValue)} = ${result.winnings}`
			utils.coinsManager.award(result.userID, result.winnings)
			return result
		}))
		// Send message
		let embed = new Discord.MessageEmbed()
			.setTitle("Correct answer:")
			.setDescription(this.correctAnswer)
			.setColor(this.color)
		if (results.length) embed.addField("Winners", results.map(r => `${String(client.users.get(r.userID))} (+${r.winnings} ${lang.emoji.discoin})`).join("\n"))
		else embed.addField("Winners", "No winners.")
		if (this.channel.type == "dm" || this.permissions && this.permissions.has("ADD_REACTIONS")) embed.setFooter("Click the reaction for another round.")
		else embed.addField(
			"Next round",
			lang.permissionDeniedGeneric("add reactions")
			+"\n\nYou can type `&trivia` or `&t` for another round."
		)
		return this.channel.send(utils.contentify(this.channel, embed)).then(msg => {
			utils.reactionMenu(msg, [
				{emoji: client.emojis.get("362741439211503616"), ignore: "total", actionType: "js", actionData: (msg, emoji, user) => {
					if (user.bot) {
						msg.channel.send(user+" SHUT UP!!!!!!!!")
					} else {
						startGame(this.channel, {category: this.category})
					}
				}}
			])
		})
	}
}
module.exports.TriviaGame = TriviaGame

/**
 * @param {string} body
 * @param {Discord.TextChannel|Discord.DMChannel} channel
 * @returns {Promise<[boolean, any]>}
 */
async function JSONHelper(body, channel) {
	try {
		if (body.startsWith("http")) body = await rp(body)
		return [true, JSON.parse(body)]
	} catch (error) {
		let embed = new Discord.MessageEmbed()
		.setDescription(`There was an error parsing the data returned by the api\n${error} `+"```\n"+body+"```")
		.setColor(0xdd1d1d)
		return [false, channel.send(utils.contentify(channel, embed))]
	}
}
/**
 * @param {Discord.TextChannel|Discord.DMChannel} channel
 * @param {{suffix?: string, msg?: Discord.Message, category?: number}} options
 */
async function startGame(channel, options = {}) {
	// Select category
	let category = options.category || null
	if (options.suffix) {
		channel.sendTyping()
		let [
			success,
			/** @type {{trivia_categories: {id: number, name: string}[]}} */
			data
		] = await JSONHelper("https://opentdb.com/api_category.php", channel)
		if (!success) return
		if (options.suffix.includes("categor")) {
			options.msg.author.send(
				new Discord.MessageEmbed()
				.setTitle("Categories")
				.setDescription(data.trivia_categories.map(c => c.name)
				.join("\n")+"\n\n"+
				"To select a category, use `&trivia <category name>`.")
			).then(() => {
				channel.send("I've sent you a DM with the list of categories.")
			}).catch(() => {
				channel.send(lang.dm.failed(options.msg))
			})
			return
		} else {
			let f = data.trivia_categories.filter(c => c.name.toLowerCase().includes(options.suffix.toLowerCase()))
			if (options.suffix.toLowerCase().endsWith("music")) f = data.trivia_categories.filter(c => c.name == "Entertainment: Music")
			if (f.length == 0) {
				return channel.send("Found no categories with that name. Use `&trivia categories` for the complete list of categories.")
			} else if (f.length >= 2) {
				return channel.send("There are multiple categories with that name: **"+f[0].name+"**, **"+f[1].name+"**"+(f.length == 2 ? ". " : `, and ${f.length-2} more. `)+"Use `&trivia categories` for the list of available categories.")
			} else {
				category = f[0].id
			}
		}
	}
	// Check games in progress
	if (gameStore.store.find(g => g.type == "trivia" && g.id == channel.id)) return channel.send(`There's a game already in progress for this channel.`)
	// Send typing
	channel.sendTyping()
	// Get new game data
	/** @type {Array<{response_code: number, results: Array<TriviaResponse>}>} */
	let body = await JSONHelper("https://opentdb.com/api.php?amount=1"+(category ? `&category=${category}` : ""), channel)
	if (!body[0]) return
	let data = body[1]
	// Error check new game data
	if (data.response_code != 0) return channel.send(`There was an error from the api`)
	// Set up new game
	new TriviaGame(channel, data, category).init()
}
utils.addTemporaryListener(client, "message", path.basename(__filename), answerDetector)
async function answerDetector(msg) {
	if (msg.author.bot) return
	let game = gameStore.store.find(g => g.id == msg.channel.id)
	if (game instanceof TriviaGame) {
		if (game) game.addAnswer(msg) // all error checking to be done inside addAnswer
	}
}


/**
 * @param {string} [difficulty="easy"] "easy", "medium" or "hard"
 * @param {number} [size=8] 4-14 inclusive
 * @returns {{text: string, size: number, bombs: number, error?: boolean}}
 */
function sweeper(difficulty, size) {
	let width = 8,
			bombs = 6,
			total = undefined,
			rows = [],
			board = [],
			pieceWhite = "⬜",
			pieceBomb = "💣",
			str = "",
			error = false

	if (difficulty) {
		if (difficulty == "easy") bombs = 6
		if (difficulty == "medium") bombs = 8
		if (difficulty == "hard") bombs = 10
	}

	if (size) {
		let num
		if (size < 4) num = 8, error = true
		else if (size > 14) num = 8, error = true
		else num = size
		width = num
	}
	total = width * width

	// Place board
	let placed = 0
	while (placed < total) {
		board[placed] = pieceWhite
		placed++
	}

	// Place bombs
	let bombsPlaced = 0
	let placement = () => {
		let index = Math.floor(Math.random() * (total - 1) + 1)
		if (board[index] == pieceBomb) placement()
		else board[index] = pieceBomb
	}
	while (bombsPlaced < bombs) {
		placement()
		bombsPlaced++
	}

	// Create rows
	let currow = 1
	board.forEach((item, index) => {
		let i = index+1
		if (!rows[currow-1]) rows[currow-1] = []
		rows[currow-1].push(item)
		if (i%width == 0) currow++
	})

	// Generate numbers
	rows.forEach((row, index) => {
		row.forEach((item, iindex) => {
			if (item == pieceBomb) {
				let uprow = rows[index-1]
				let downrow = rows[index+1]
				let num = (it) => { return typeof it == "number" }
				let bmb = (it) => { return it == pieceBomb }
				let undef = (it) => { return it == undefined }

				if (uprow) {
					if (!bmb(uprow[iindex-1])) {
						if (num(uprow[iindex-1])) uprow[iindex-1]++
						else if (!undef(uprow[iindex-1])) uprow[iindex-1] = 1
					}

					if (!bmb(uprow[iindex])) {
						if (num(uprow[iindex])) uprow[iindex]++
						else if (!undef(uprow[iindex])) uprow[iindex] = 1
					}

					if (!bmb(uprow[iindex+1])) {
						if (num(uprow[iindex+1])) uprow[iindex+1]++
						else if (!undef(uprow[iindex+1])) uprow[iindex+1] = 1
					}
				}

				if (!bmb(row[iindex-1])) {
					if (num(row[iindex-1])) row[iindex-1]++
					else if (!undef(row[iindex-1])) row[iindex-1] = 1
				}

				if (!bmb(row[iindex+1])) {
					if (num(row[iindex+1])) row[iindex+1]++
					else if (!undef(row[iindex+1])) row[iindex+1] = 1
				}

				if (downrow) {
					if (!bmb(downrow[iindex-1])) {
						if (num(downrow[iindex-1])) downrow[iindex-1]++
						else if (!undef(downrow[iindex-1])) downrow[iindex-1] = 1
					}

					if (!bmb(downrow[iindex])) {
						if (num(downrow[iindex])) downrow[iindex]++
						else if (!undef(downrow[iindex])) downrow[iindex] = 1
					}

					if (!bmb(downrow[iindex+1])) {
						if (num(downrow[iindex+1])) downrow[iindex+1]++
						else if (!undef(downrow[iindex+1])) downrow[iindex+1] = 1
					}
				}
			}
		})
	})

	// Create a string to send
	rows.forEach(row => {
		row.forEach(item => {
			let it
			if (typeof item == "number") it = numbers[item-1]
			else it = item
			str += `||${it}||`
		})
		str += "\n"
	})
	return { text: str, size: width, bombs: bombs, error: error }
}

commands.assign({
	"trivia": {
		usage: "[category]",
		description: "Play a game of trivia with other members and win Discoins",
		aliases: ["trivia", "t"],
		category: "games",
		process: async function(msg, suffix) {
			startGame(msg.channel, {suffix, msg})
		}
	},
	"minesweeper": {
		usage: "[easy|medium|hard] [--raw] [--size:number]",
		description: "Starts a game of minesweeper using the Discord spoiler system",
		aliases: ["minesweeper", "ms"],
		category: "games",
		process: function(msg, suffix) {
			let size = 8, difficulty = "easy"
			let string, title
			let sfx = suffix.toLowerCase()

			if (sfx.includes("--size:")) {
				let tsize = +sfx.split("--size:")[1].split(" ")[0]
				if (isNaN(tsize)) size = 8
				else size = Math.floor(Number(tsize))
			}

			if (sfx.includes("medium")) difficulty = "medium"
			else if (sfx.includes("hard")) difficulty = "hard"

			string = sweeper(difficulty, size)

			title = `${difficulty} -- ${string.bombs} bombs, ${string.size}x${string.size} board`
			if (string.error) title += "\nThe minimum size is 4 and the max is 14. Bounds have been adjusted to normals"
			let embed = new Discord.MessageEmbed().setColor("36393E").setTitle(title).setDescription(string.text)
			if (sfx.includes("-r") || sfx.includes("--raw")) {
				let rawcontent = `${title}\n${string.text}`.replace(/\|/g, "\\|")
				if (rawcontent.length > 1999) return msg.channel.send("The raw content exceeded the 2000 character limit. Consider using a smaller board size")
				return msg.channel.send(rawcontent)
			}
			msg.channel.send(utils.contentify(msg.channel, embed))
		}
	}
})
