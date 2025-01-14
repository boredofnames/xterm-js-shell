import LocalEchoController from 'local-echo'
import { EventIterator } from 'event-iterator'

const style = require('ansi-styles')
const minimist = require('minimist')
const stringToArgv = require('string-to-argv')

const ERROR_NOT_FOUND = command => `Command Not Found: ${command}`
const ERROR_ALREADY_REGISTERED = command =>
	`Command Already Registered: ${command}`

const WHITESPACE_REGEX = /[\s\r\n]+/g

/**
 * Command structure
 * @callback Command
 * @param {SubShell} shell Shell instance for input/output
 * @param {Array<string>} args Arguments for the command
 */

/**
 * Autocomplete Callback structure
 * @callback AutocompleteProvider
 * @param {number} index The index in the args array to autocomplete
 * @param {Array<string>} args The list of arguments being passed to the command
 * @return {Array<string>} The list of options the user could try
 */

/** Shell abstraction for Xterm.js */
export default class XtermJSShell {
	/**
	 * Instantiate and attach a shell to the terminal
	 * @param {Terminal} term The xterm.js terminal
	 */
	constructor(term) {
		this.prompt = async () => '$ '
		this.commands = new Map()
		this.echo = new LocalEchoController(term)
		this.term = term
		this.env = {}

		this.attached = true

		this.echo.addAutocompleteHandler(
			this.autoCompleteCommands.bind(this),
		)
	}

	/**
	 * Detach the shell from xtermjs
	 */
	detach() {
		if (!this.attached) return
		this.echo.detach()
		this.attached = false
	}

	/**
	 * Attach the shell to the terminal
	 */
	attach() {
		if (this.attached) return
		this.echo.attach()
		this.attached = true
	}

	/**
	 * Utility for doing colors
	 * @return {object} The foreground instance of [ansi-colors](https://github.com/chalk/ansi-styles)
	 */
	get color() {
		return style.color
	}

	get bgColor() {
		return style.bgColor
	}

	/**
	 * Read-eval-print-loop, run this to start the shell
	 * @return {Promise} Resolves after a pass of the loop finishes
	 */
	async repl() {
		// Read
		const prompt = await this.prompt()
		const line = await this.echo.read(prompt)

		const argv = stringToArgv(line)

		const command = argv.shift()
		const parsed = minimist(argv)

		const raw_args = parsed._

		try {
			// Eval / Print
			await this.run(command, raw_args, parsed)
		} catch (e) {
			console.error(e)
			await this.echo.println(e.message)
		}

		// Loop
		this.repl()
	}

	/**
	 * Run a command in the shell
	 * @param  {string}         command The name of the command to run
	 * @param  {Array<string>}  args    The list of command arguments to run
	 * @return {Promise}                Resolves after the command has finished
	 */
	async run(command, args, flags) {
		if (!command) return
		if (!this.commands.has(command))
			throw new TypeError(ERROR_NOT_FOUND(command))

		const { fn } = this.commands.get(command)

		const shell = new SubShell(this)

		const result = fn(shell, args, flags)

		if (result.then) {
			await result
		} else if (result.next) {
			for await (let data of result) {
				shell.print(data)
			}
		}

		shell.destroy()
	}

	/**
	 * Add a command to the shell
	 * @param  {string}        command The name of the command
	 * @param  {Command}      fn      Async function that takes a shell / args
	 * @return {XtermJSShell}          Returns self for chaining
	 */
	command(command, fn, autocomplete) {
		if (this.commands.has(command)) {
			console.warn(ERROR_ALREADY_REGISTERED(command))
		}

		this.commands.set(command, {
			command,
			fn,
			autocomplete,
		})

		return this
	}

	// Internal command for auto completion of command names
	autoCompleteCommands(index, tokens) {
		const command = tokens[0]
		if (index === 0) {
			return [...this.commands.keys()]
		} else if (this.commands.has(command)) {
			const { autocomplete } = this.commands.get(command)
			if (!autocomplete) return []
			return autocomplete(index - 1, tokens.slice(1))
		} else {
			return []
		}
	}

	async readChar(message) {
		return this.echo.readChar(message)
	}

	async readLine(message) {
		return this.echo.read(message)
	}

	async abortRead(reason) {
		return this.echo.abortRead(reason)
	}

	async print(message) {
		return this.term.write(message)
	}

	async printLine(message) {
		return this.echo.println(message)
	}

	async printList(list) {
		return this.echo.printWide(list)
	}

	async clear() {
		return this.term.clear()
	}
}

class SubShell {
	constructor(shell) {
		this.shell = shell
		this.destroyed = false
	}

	async *readStream() {
		let dataListener
		const iterator = new EventIterator(
			push => {
				dataListener = this.shell.term.onData(push)
				this.shell.detach()
			},
			() => {
				dataListener.dispose()
				this.shell.attach()
			},
		)

		for await (let data of iterator) {
			if (this.destroyed) break
			yield data
		}
	}

	async readChar(message) {
		this.checkDestroyed()
		return this.shell.readChar(message)
	}

	async readLine(message) {
		this.checkDestroyed()
		return this.shell.readLine(message)
	}

	async abortRead(reason) {
		this.checkDestroyed()
		return this.shell.abortRead(reason)
	}

	async print(message) {
		this.checkDestroyed()
		this.shell.print(message)
	}

	async printLine(message) {
		this.checkDestroyed()
		this.shell.printLine(message)
	}

	async printList(list) {
		this.checkDestroyed()
		this.shell.printList(list)
	}

	async clear() {
		this.checkDestroyed()
		this.shell.clear()
	}

	get color() {
		return style.color
	}

	get bgColor() {
		return style.bgColor
	}

	get commands() {
		return [...this.shell.commands.keys()]
	}

	get env() {
		return this.shell.env
	}

	get cols() {
		return this.shell.cols
	}

	get rows() {
		return this.shell.rows
	}

	checkDestroyed() {
		if (this.destroyed) throw new Error('Terminal destroyed')
	}

	destroy() {
		this.destroyed = true
	}
}
