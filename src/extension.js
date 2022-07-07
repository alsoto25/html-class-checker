// @ts-nocheck
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const posix = require('path/posix');
const path = require("path");
const fetch = require("node-fetch");

const {window, workspace, commands} = vscode;
const thirdPartyFilesName = 'html-class-checker.thirdPartyFiles';
const defaultDirectoryName = 'html-class-checker.defaultDirectory';

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	// If there's no third parties loaded, initialize empty list
	if (!context.workspaceState.get(thirdPartyFilesName)) context.workspaceState.update(thirdPartyFilesName, []);

	/*******************************************************************************************************/
	/*********************************************** Buttons ***********************************************/
	/*******************************************************************************************************/

	const searchButton = window.createStatusBarItem(vscode.StatusBarAlignment.Right, 20);
	searchButton.command = 'html-class-checker.searchButtonClick';
	searchButton.text = `$(tasklist) Unused Classes`;
	if (!(context.workspaceState.get(defaultDirectoryName) !== null && context.workspaceState.get(defaultDirectoryName) !== undefined && context.workspaceState.get(defaultDirectoryName) >= 0))
		searchButton.hide();

	/*******************************************************************************************************/
	/***************************************** Subscribed Commands *****************************************/
	/*******************************************************************************************************/

	// Reloads third party contents when called
	const reloadThirdParties = commands.registerCommand('html-class-checker.reloadThirdParties', async function () {
		const config = workspace.getConfiguration('html-class-checker');

		context.workspaceState.update(thirdPartyFilesName, []);
		if (config.setThirdPartyLibraries.length) {
			const urls = config.setThirdPartyLibraries;
			for (let url of urls) {
				const file = await fetch.default(url);
				const data = await file.text();
				context.workspaceState.update(thirdPartyFilesName, [...context.workspaceState.get(thirdPartyFilesName), data]);
			}
		}

		// Event to reload third parties when this specific configuration changes
		workspace.onDidChangeConfiguration((e) => {
			e.affectsConfiguration('html-class-checker.setThirdPartyLibraries') && commands.executeCommand('html-class-checker.reloadThirdParties');
		});
	});

	// Finds and loops through all unused classes, showing them to the user
	const displayUnusedClasses = commands.registerCommand('html-class-checker.displayUnusedClasses', async () => {
		if (!window.activeTextEditor || posix.extname(window.activeTextEditor.document.uri.path) !== '.html')
			return window.showInformationMessage('Open an HTML file first');

		await showUnusedClasses(context, false);
		searchButton.show();
	});

	// Finds and loops through all unused classes, showing them to the user
	const searchButtonClick = commands.registerCommand('html-class-checker.searchButtonClick', async () => {
		if (!window.activeTextEditor || posix.extname(window.activeTextEditor.document.uri.path) !== '.html')
			return window.showInformationMessage('Open an HTML file first');

		await showUnusedClasses(context, true);
	});

	// Opens up the settings with the 'html-class-checker' section on view
	const displaySettings = commands.registerCommand('html-class-checker.displaySettings', () => {
		commands.executeCommand( 'workbench.action.openSettings', 'html-class-checker');
	});

	/*******************************************************************************************************/
	/*************************************** Non-subscribed Commands ***************************************/
	/*******************************************************************************************************/

	// Removes an individual class (Registers on text Editor to allow file modifications)
	commands.registerTextEditorCommand('html-class-checker.removeSingleClass', (te, editDoc, classToRemove) => {
		const classPositions = findPositionsOfWordWithContext(classToRemove, window.activeTextEditor.document);

		if (classPositions.length) {
			classPositions.map(val => {
				const classRange = new vscode.Range(...val);
				editDoc.delete(classRange);
			});
			window.showInformationMessage(`Class(es) removed successfully!`);
		} else {
			window.showInformationMessage(`Class "${classToRemove}" could not be deleted.`);
		}
	});

	// Selects an specific class inside the file
	commands.registerTextEditorCommand('html-class-checker.selectClass', (textEditor, edit, index, unusedClasses) => {
		const classPositions = findPositionsOfWord(unusedClasses[index], window.activeTextEditor.document);

		if (classPositions.length) {
			const classSelection = classPositions.reduce((acc, val) => [...acc, new vscode.Selection(...val)], []);
			const classRange = new vscode.Range(...classPositions[0]);
			textEditor.selections = classSelection;
			textEditor.revealRange(classRange);
		}
	});

	context.subscriptions.push(searchButton);
	context.subscriptions.push(displaySettings);
	context.subscriptions.push(reloadThirdParties);
	context.subscriptions.push(displayUnusedClasses);

	commands.executeCommand('html-class-checker.reloadThirdParties');
}

function deactivate() {};

/**
 * Looks for all valid files where a class would be used inside the project
 * @param {vscode.ExtensionContext} context
 * @returns {vscode.Uri[]} All files found
 */
async function searchAllFiles(context) {
	const relativePattern = new vscode.RelativePattern(context, '**/*.{js,ts,css,scss}')
	const allFiles = await workspace.findFiles(relativePattern, '**/node_modules');

	return allFiles;
};

/**
 * Look for classes inside a certain file
 * @param {string[]} classList List of classes to look for in a file
 * @param {vscode.Uri} file File where the classes will be looked into
 * @returns {string[]} List with the classes found in the file
 */
async function findClassesInFile(classList, file) {
	const classesFound = [];

	await workspace.openTextDocument(file.path).then((document) => {
		const text = document.getText();

		classList.map(classItem => {
			if (text.match(classItem)) classesFound.push(classItem);
		});
	});

	return classesFound;
};

/**
 * Look for all classes in the HTML file and filter out the classes being used.
 * @param {vscode.ExtensionContext} context
 * @returns {string[]} List of classes not being used
 */
async function findUnusedClasses(context, isFromButton = false) {
	let filteredMatches = [];
	let fixedSelect;

	const hasDefaultCached = context.workspaceState.get(defaultDirectoryName) !== null && context.workspaceState.get(defaultDirectoryName) !== undefined && context.workspaceState.get(defaultDirectoryName) >= 0;
	const document = await workspace.openTextDocument(window.activeTextEditor.document.uri.path)
	const text = document.getText();
	// Regex to get all classes from a string
	const classCheckRegex = new RegExp('class="((?:[a-z0-9\-\_]+)(?: (?:[a-z0-9\-\_]+))*)"', 'g');

	// Match and filter all unique classes present
	const matches = [...text.matchAll(classCheckRegex)];
	filteredMatches = [...new Set(matches.reduce((acc, val) => {
			return acc.concat(val[1].split(' '));
		}, []))];

	// Find Workspace path of current active file
	const activeEditorPath = window.activeTextEditor.document.uri.path;
	const matchingWorkspace = workspace.workspaceFolders?.find(
		(wsFolder) => {
				const relative = path.relative(wsFolder.uri.fsPath, activeEditorPath);
				return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
		}
	).uri.fsPath;

	// Remove last index and have an array with all valid directory options
	let hasDefaultOption = false;
	const directoryList = activeEditorPath.substring(matchingWorkspace.length).split('/');
	directoryList[0] = '.';
	directoryList.pop();

	if (isFromButton && hasDefaultCached) {
		fixedSelect = directoryList[context.workspaceState.get(defaultDirectoryName)];
	} else {
		// Add default option if present
		if (hasDefaultCached) {
			hasDefaultOption = true;
			directoryList.unshift(`${directoryList[context.workspaceState.get(defaultDirectoryName)]} (default)`);
		} else {
			context.workspaceState.update(defaultDirectoryName, null);
		}

		// Let user pick context
		const contextSelect = await window.showQuickPick(directoryList, {
			placeHolder: 'Select the context for the file search',
		});

		// Remove "(default)" from option
		fixedSelect = contextSelect.toString().includes('(default)') ? contextSelect.toString().substring(0, contextSelect.length - 10) : contextSelect.toString();

		// If selection was different than the one stored, update default option
		if (!contextSelect.includes('(default)')) context.workspaceState.update(defaultDirectoryName, hasDefaultOption ? directoryList.indexOf(fixedSelect) - 1 : directoryList.indexOf(fixedSelect));
	}

	// Find index of the selected option
	const selectedIndex =  hasDefaultOption ? context.workspaceState.get(defaultDirectoryName) + 2 : context.workspaceState.get(defaultDirectoryName) + 1;

	// If user didn't pick parent closest to file, remove all unnecessary directories
	if (selectedIndex < directoryList.length)
		directoryList.splice(selectedIndex, directoryList.length - selectedIndex);

	// If user didn't pick root directory, append directories to workspace path
	directoryList.splice(0, hasDefaultOption ? 2 : 1);
	const directoryContext = fixedSelect === '.' ? matchingWorkspace : `${matchingWorkspace}/${directoryList.join('/')}`;
	const allFiles = await searchAllFiles(directoryContext);

	// Find all classes in each local file
	for (let file of allFiles) {
		const foundClasses = await findClassesInFile(filteredMatches, file);
		filteredMatches = filteredMatches.filter(val => foundClasses.indexOf(val) === -1);
	}

	// Find all classes in each local file
	for (let data of context.workspaceState.get(thirdPartyFilesName)) {
		filteredMatches = filteredMatches.filter(val => !data.match(val));
	}
	// Found all unused classes!
	return filteredMatches;
}

/**
 * Look for the position of a word inside a document
 * @param {string} word Word to look for inside the file
 * @param {vscode.TextDocument} document File where the word will be searched
 * @returns {vscode.Position[][]} List of positions for the word
 */
function findPositionsOfWord(word, document) {
	const positions = [];
	const splitDocument = document.getText().split('\n');
	let line = 0;

	if (!document.getText().match(new RegExp(`[ "]${word}[ "]`, 'g'))) return positions;

	while (line < document.lineCount) {
		const regex = new RegExp(`[ "]${word}[ "]`, 'g');
		if (splitDocument[line].match(regex))
			positions.push([
				new vscode.Position(line, splitDocument[line].search(regex) + 1),
				new vscode.Position(line, splitDocument[line].search(regex) + word.length + 1),
			]);
		line++;
	}

	return positions;
}

/**
 * Look for the position of a word inside a document in addition to
 * any extra spaces or even the class attribute if it's the only class present in a tag
 * @param {string} word Word to look for inside the file
 * @param {vscode.TextDocument} document File where the word will be searched
 * @returns {vscode.Position[][]} List of positions for the word
 */
function findPositionsOfWordWithContext(word, document) {
	const positions = [];
	const splitDocument = document.getText().split('\n');
	let line = 0;

	if (!document.getText().match(new RegExp(`[ "]${word}[ "]`, 'g'))) return positions;

	while (line < document.lineCount) {
		if (splitDocument[line].match(new RegExp(`[ "]${word}[ "]`, 'g'))) {
			const loneClassRegex = new RegExp(` class=" *${word} *"`, 'g');
			const bothSpacesClassRegex = new RegExp(` +${word} +`, 'g');
			const leftSpaceClassRegex = new RegExp(` +${word}"`, 'g');
			const rightSpaceClassRegex = new RegExp(`"${word} +`, 'g');

			const loneClassMatch = splitDocument[line].match(loneClassRegex);
			const bothSpacesClassMatch = splitDocument[line].match(bothSpacesClassRegex);
			const leftSpaceClassMatch = splitDocument[line].match(leftSpaceClassRegex);
			const rightSpaceClassMatch = splitDocument[line].match(rightSpaceClassRegex);

			if (loneClassMatch)
				positions.push([
					new vscode.Position(line, splitDocument[line].search(loneClassRegex)),
					new vscode.Position(line, splitDocument[line].search(loneClassRegex) + loneClassMatch[0].length),
				]);
			else if (bothSpacesClassMatch)
				positions.push([
					new vscode.Position(line, splitDocument[line].search(bothSpacesClassRegex)),
					new vscode.Position(line, splitDocument[line].search(bothSpacesClassRegex) + bothSpacesClassMatch[0].length - 1),
				]);
			else if (leftSpaceClassMatch || bothSpacesClassMatch)
				positions.push([
					new vscode.Position(line, splitDocument[line].search(leftSpaceClassRegex)),
					new vscode.Position(line, splitDocument[line].search(leftSpaceClassRegex) + leftSpaceClassMatch[0].length - 1),
				]);
			else if (rightSpaceClassMatch)
				positions.push([
					new vscode.Position(line, splitDocument[line].search(rightSpaceClassRegex) + 1),
					new vscode.Position(line, splitDocument[line].search(rightSpaceClassRegex) + rightSpaceClassMatch[0].length),
				]);
		}
		line++;
	}

	return positions;
}

async function showUnusedClasses(context, isFromButton) {
	const unusedClasses = await findUnusedClasses(context, isFromButton);

	const message = unusedClasses.length ? `Found ${unusedClasses.length} unused classes!` : 'No unused classes found!';
	!unusedClasses.length ? window.showInformationMessage(message) :
		// Shows message if there were any unused classes found
		window.showInformationMessage(message, 'See Classes').then((res) => {
			switch (res) {
				// See each class individually
				case 'See Classes':
					let index = 0;
					commands.executeCommand('html-class-checker.selectClass', index, unusedClasses);
					function showClassesInfoWindow() {
						// You can choose whether to leave class and see next one or delete it and see the next one
						window.showInformationMessage(unusedClasses[index], 'Delete', index === unusedClasses.length-1 ? 'Close' : 'Next').then((res) => {
							switch (res) {
								case 'Next':
									index++;
									commands.executeCommand('html-class-checker.selectClass', index, unusedClasses);
									index < unusedClasses.length && showClassesInfoWindow();
									break;
								case 'Delete':
									commands.executeCommand('html-class-checker.removeSingleClass', unusedClasses[index]);
									setTimeout(function() {
										index++;
										commands.executeCommand('html-class-checker.selectClass', index, unusedClasses);
										index < unusedClasses.length && showClassesInfoWindow();
									}, 300);
							}
						});
					};

					showClassesInfoWindow();
					break;
				default:
			}
		});
	return unusedClasses;
}

module.exports = {
	activate,
	deactivate
}
