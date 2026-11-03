import JSZip from 'jszip';
import { isCorrect, isScored, playerRows, questionMaxima, scoredQuestionCount } from '$lib/reports';
import type { ReportBody } from '$lib/storage';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export { XLSX_MIME };

type CellStyle = 'header' | 'date' | 'percent' | 'decimal' | 'integer' | 'wrap';
type CellValue = string | number | Date | null | undefined;
type Cell = CellValue | { value: CellValue; style: CellStyle };
type Sheet = { name: string; rows: Cell[][]; widths: number[] };

const styleIds: Record<CellStyle, number> = {
	header: 1,
	date: 2,
	percent: 3,
	decimal: 4,
	integer: 5,
	wrap: 6
};

export function safeExcelString(value: string): string {
	return /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function safeFilePart(value: string): string {
	return (
		stripControlCharacters(value)
			.replace(/[\\/:*?"<>|]/g, '_')
			.trim()
			.replace(/[. ]+$/, '')
			.slice(0, 80) || 'report'
	);
}

function stripControlCharacters(value: string): string {
	return [...value]
		.filter((character) => {
			const code = character.charCodeAt(0);
			return code === 9 || code === 10 || code === 13 || code >= 32;
		})
		.join('');
}

export function reportXlsxFileName(report: ReportBody): string {
	const date = new Date(report.playedAt)
		.toISOString()
		.slice(0, 16)
		.replace('T', '_')
		.replace(':', '-');
	return `SE-Quiz_${safeFilePart(report.gameCode ?? 'room')}_${safeFilePart(report.title)}_${date}.xlsx`;
}

function xml(value: string): string {
	return stripControlCharacters(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function columnName(index: number): string {
	let name = '';
	for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
		name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
	}
	return name;
}

function styled(value: CellValue, style: CellStyle): Cell {
	return { value, style };
}

function unwrap(cell: Cell): { value: CellValue; style?: CellStyle } {
	return typeof cell === 'object' && cell !== null && !(cell instanceof Date)
		? cell
		: { value: cell };
}

function cellXml(cell: Cell, column: number, row: number): string {
	const { value, style } = unwrap(cell);
	if (value === null || value === undefined) return '';
	const ref = `${columnName(column)}${row}`;
	const styleAttribute = style ? ` s="${styleIds[style]}"` : '';
	if (value instanceof Date) {
		return `<c r="${ref}" s="2"><v>${value.getTime() / 86_400_000 + 25_569}</v></c>`;
	}
	if (typeof value === 'number') {
		return `<c r="${ref}"${styleAttribute}><v>${Number.isFinite(value) ? value : 0}</v></c>`;
	}
	return `<c r="${ref}" t="inlineStr"${styleAttribute}><is><t xml:space="preserve">${xml(safeExcelString(value))}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
	const lastColumn = columnName(Math.max(0, sheet.widths.length - 1));
	const lastRow = Math.max(1, sheet.rows.length);
	const columns = sheet.widths
		.map(
			(width, index) =>
				`<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
		)
		.join('');
	const rows = sheet.rows
		.map(
			(row, rowIndex) =>
				`<row r="${rowIndex + 1}">${row.map((cell, column) => cellXml(cell, column, rowIndex + 1)).join('')}</row>`
		)
		.join('');
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastColumn}${lastRow}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/><cols>${columns}</cols><sheetData>${rows}</sheetData>
<autoFilter ref="A1:${lastColumn}${lastRow}"/>
</worksheet>`;
}

function totals(report: ReportBody): number[] {
	return playerRows(report).map(({ total }) => total);
}

function maximums(report: ReportBody): number[] {
	const observed = questionMaxima(report);
	return report.questions.map((question, index) =>
		report.scoreMode === 'correctness'
			? Number(isScored(question))
			: (question.pointsAwarded ?? observed[index] ?? 0)
	);
}

function responseMap(report: ReportBody): Map<string, string[]> {
	return new Map(report.responses ?? []);
}

function teamMaps(report: ReportBody) {
	const membersByTeam = new Map(report.teams ?? []);
	const teamByMember = new Map<string, string>();
	for (const [team, members] of report.teams ?? []) {
		for (const member of members) teamByMember.set(member, team);
	}
	return { membersByTeam, teamByMember };
}

function roomSummary(report: ReportBody, exportedAt: Date): Sheet {
	const scores = totals(report);
	const sorted = scores.slice().sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	const median = sorted.length
		? sorted.length % 2
			? sorted[middle]
			: (sorted[middle - 1] + sorted[middle]) / 2
		: 0;
	const maxScore = maximums(report).reduce((sum, value) => sum + value, 0);
	const submissions = report.responses?.reduce(
		(sum, [, answers]) => sum + answers.filter((answer) => answer !== '').length,
		0
	);
	const rows: Cell[][] = [
		[styled('Room Information', 'header'), styled('Value', 'header')],
		['Room Code', report.gameCode],
		['Game / Quiz Name', report.title],
		['Game / Quiz ID', report.fuizUniqueId],
		['Activity Type', 'Fuiz'],
		['Room Status', 'Completed'],
		['Ended At', styled(new Date(report.playedAt), 'date')],
		['Exported At', styled(exportedAt, 'date')],
		[styled('Participation Statistics', 'header'), styled('Value', 'header')],
		['Total Participants', styled(report.playerCount, 'integer')],
		['Total Teams', report.teams ? styled(report.teams.length, 'integer') : undefined],
		['Total Questions', styled(report.questions.length, 'integer')],
		[
			'Total Answer Submissions',
			submissions === undefined ? undefined : styled(submissions, 'integer')
		],
		['Maximum Possible Score', styled(maxScore, 'decimal')],
		['Highest Score', styled(Math.max(0, ...scores), 'decimal')],
		['Lowest Score', styled(scores.length ? Math.min(...scores) : 0, 'decimal')],
		[
			'Average Score',
			styled(
				scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0,
				'decimal'
			)
		],
		['Median Score', styled(median, 'decimal')]
	];
	return { name: 'Room Summary', rows, widths: [32, 44] };
}

function participants(report: ReportBody): Sheet {
	const responses = responseMap(report);
	const { membersByTeam } = teamMaps(report);
	const maxScore = maximums(report).reduce((sum, value) => sum + value, 0);
	const scoredCount = scoredQuestionCount(report);
	const rows: Cell[][] = [
		[
			'Rank',
			'Participant / Team Name',
			'Team Members',
			'Questions Answered',
			'Correct Answers',
			'Incorrect Answers',
			'Unanswered Questions',
			'Accuracy',
			'Total Score',
			'Maximum Score',
			'Score Percentage',
			'Final Status'
		].map((value) => styled(value, 'header'))
	];
	for (const [index, player] of playerRows(report).entries()) {
		const answers = responses.get(player.name);
		const answered = answers?.filter(
			(answer, question) => isScored(report.questions[question]) && answer !== ''
		).length;
		const incorrect =
			answered === undefined ? undefined : Math.max(0, answered - player.correctCount);
		const unanswered = answered === undefined ? undefined : Math.max(0, scoredCount - answered);
		rows.push([
			styled(index + 1, 'integer'),
			player.name,
			membersByTeam.get(player.name)?.join(', '),
			answered === undefined ? undefined : styled(answered, 'integer'),
			styled(player.correctCount, 'integer'),
			incorrect === undefined ? undefined : styled(incorrect, 'integer'),
			unanswered === undefined ? undefined : styled(unanswered, 'integer'),
			answered ? styled(player.correctCount / answered, 'percent') : undefined,
			styled(player.total, 'decimal'),
			styled(maxScore, 'decimal'),
			maxScore > 0 ? styled(player.total / maxScore, 'percent') : undefined,
			answered === undefined ? 'Unknown' : unanswered === 0 ? 'Completed' : 'Incomplete'
		]);
	}
	return { name: 'Participants', rows, widths: [8, 28, 32, 19, 16, 18, 21, 12, 14, 16, 18, 16] };
}

function questions(report: ReportBody): Sheet {
	const responses = report.responses ?? [];
	const max = maximums(report);
	const rows: Cell[][] = [
		[
			'Question Number',
			'Question ID',
			'Question Type',
			'Question / Prompt',
			'Correct Answer',
			'Maximum Score',
			'Number of Participants',
			'Number Answered',
			'Number Correct',
			'Number Incorrect',
			'Number Unanswered',
			'Correct Rate',
			'Incorrect Rate',
			'Average Score'
		].map((value) => styled(value, 'header'))
	];
	report.questions.forEach((question, index) => {
		const responseCount = responses.length
			? responses.filter(([, answers]) => (answers[index] ?? '') !== '').length
			: question.correct + question.wrong;
		const incorrect = isScored(question)
			? Math.max(0, responseCount - question.correct)
			: undefined;
		const scores = report.results.map(([, values]) => values[index] ?? 0);
		rows.push([
			styled(index + 1, 'integer'),
			question.id === undefined ? undefined : styled(question.id, 'integer'),
			question.type,
			styled(question.title, 'wrap'),
			styled(question.correctAnswer ?? '', 'wrap'),
			styled(max[index], 'decimal'),
			styled(report.playerCount, 'integer'),
			styled(responseCount, 'integer'),
			isScored(question) ? styled(question.correct, 'integer') : undefined,
			incorrect === undefined ? undefined : styled(incorrect, 'integer'),
			styled(Math.max(0, report.playerCount - responseCount), 'integer'),
			isScored(question) && report.playerCount > 0
				? styled(question.correct / report.playerCount, 'percent')
				: undefined,
			incorrect !== undefined && report.playerCount > 0
				? styled(incorrect / report.playerCount, 'percent')
				: undefined,
			styled(
				scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0,
				'decimal'
			)
		]);
	});
	return {
		name: 'Questions',
		rows,
		widths: [17, 13, 20, 50, 35, 16, 23, 18, 17, 19, 21, 14, 16, 16]
	};
}

function answerDetails(report: ReportBody): Sheet {
	const ranked = playerRows(report);
	const resultByName = new Map(
		ranked.map((player, index) => [player.name, { ...player, rank: index + 1 }])
	);
	const { teamByMember } = teamMaps(report);
	const entrants = report.responses?.length ? report.responses : report.results;
	const max = maximums(report);
	const rows: Cell[][] = [
		[
			'Participant Name',
			'Team',
			'Rank',
			'Question Number',
			'Question ID',
			'Question',
			'Question Type',
			'Submitted Answer',
			'Correct Answer',
			'Is Correct',
			'Score Earned',
			'Maximum Score',
			'Answer Status'
		].map((value) => styled(value, 'header'))
	];
	for (const [name, answers] of entrants) {
		const team = teamByMember.get(name);
		const result = resultByName.get(team ?? name);
		for (const [index, question] of report.questions.entries()) {
			const answer = report.responses ? (answers[index] ?? '') : '';
			const score = team ? undefined : result?.scores[index];
			const scored = isScored(question);
			const status = !answer
				? report.responses
					? 'Unanswered'
					: 'Unknown'
				: !scored
					? 'Answered'
					: isCorrect(score ?? 0)
						? 'Correct'
						: 'Incorrect';
			rows.push([
				name,
				team,
				result ? styled(result.rank, 'integer') : undefined,
				styled(index + 1, 'integer'),
				question.id === undefined ? undefined : styled(question.id, 'integer'),
				styled(question.title, 'wrap'),
				question.type,
				styled(answer, 'wrap'),
				styled(question.correctAnswer ?? '', 'wrap'),
				scored && score !== undefined ? (isCorrect(score) ? 'Yes' : 'No') : undefined,
				score === undefined ? undefined : styled(score, 'decimal'),
				styled(max[index], 'decimal'),
				status
			]);
		}
	}
	return {
		name: 'Answer Details',
		rows,
		widths: [25, 22, 8, 17, 13, 48, 20, 38, 35, 12, 14, 16, 16]
	};
}

function leaderboard(report: ReportBody): Sheet {
	const maxScore = maximums(report).reduce((sum, value) => sum + value, 0);
	const responses = responseMap(report);
	const rows: Cell[][] = [
		[
			'Rank',
			'Participant / Team Name',
			'Correct Answers',
			'Questions Answered',
			'Accuracy',
			'Score',
			'Maximum Score'
		].map((value) => styled(value, 'header'))
	];
	playerRows(report).forEach((player, index) => {
		const answered = responses
			.get(player.name)
			?.filter((answer, question) => isScored(report.questions[question]) && answer !== '').length;
		rows.push([
			styled(index + 1, 'integer'),
			player.name,
			styled(player.correctCount, 'integer'),
			answered === undefined ? undefined : styled(answered, 'integer'),
			answered ? styled(player.correctCount / answered, 'percent') : undefined,
			styled(player.total, 'decimal'),
			styled(maxScore, 'decimal')
		]);
	});
	return { name: 'Leaderboard', rows, widths: [8, 30, 17, 19, 12, 14, 16] };
}

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="165" formatCode="0.00%"/><numFmt numFmtId="166" formatCode="#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export async function reportToXlsx(
	report: ReportBody,
	exportedAt = new Date()
): Promise<ArrayBuffer> {
	const sheets = [
		roomSummary(report, exportedAt),
		participants(report),
		questions(report),
		answerDetails(report),
		leaderboard(report)
	];
	const zip = new JSZip();
	zip.file(
		'[Content_Types].xml',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`
	);
	zip.file(
		'_rels/.rels',
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'
	);
	zip.file(
		'docProps/core.xml',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(report.title)}</dc:title><dc:creator>SE Quiz</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${exportedAt.toISOString()}</dcterms:created></cp:coreProperties>`
	);
	zip.file(
		'docProps/app.xml',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>SE Quiz</Application><TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${sheets.map((sheet) => `<vt:lpstr>${xml(sheet.name)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts></Properties>`
	);
	zip.file('xl/styles.xml', styles);
	zip.file(
		'xl/workbook.xml',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`
	);
	zip.file(
		'xl/_rels/workbook.xml.rels',
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
	);
	sheets.forEach((sheet, index) => {
		zip.file(`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet));
	});
	return new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
		.buffer;
}
