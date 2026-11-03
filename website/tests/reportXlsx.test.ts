import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { reportToXlsx, reportXlsxFileName, safeExcelString } from '../src/lib/reportXlsx';
import type { ReportBody } from '../src/lib/storage';

const report: ReportBody = {
	title: 'ชีววิทยา: Cells?',
	playedAt: Date.UTC(2026, 8, 13, 3, 4),
	gameCode: 'AB/CD',
	playerCount: 2,
	questions: [
		{
			id: 0,
			type: 'MultipleChoice',
			title: '=What is ATP?',
			correctAnswer: 'Energy',
			correct: 1,
			wrong: 1,
			pointsAwarded: 1000
		},
		{
			id: 1,
			type: 'FreeText',
			title: 'Reflection',
			correctAnswer: '',
			correct: 0,
			wrong: 0,
			pointsAwarded: 0
		}
	],
	results: [
		['+cmd', [1000, 0]],
		['ผู้เรียน', [0, 0]]
	],
	responses: [
		['+cmd', ['Energy', '@test']],
		['ผู้เรียน', ['', '-1+1']]
	]
};

describe('reportToXlsx', () => {
	it('builds the five report sheets with saved results and safe user text', async () => {
		const archive = await JSZip.loadAsync(
			await reportToXlsx(report, new Date(Date.UTC(2026, 8, 13, 4, 5)))
		);
		const workbook = await archive.file('xl/workbook.xml')?.async('string');
		const sheets = await Promise.all(
			[1, 2, 3, 4, 5].map((number) =>
				archive.file(`xl/worksheets/sheet${number}.xml`)?.async('string')
			)
		);

		expect(workbook).toContain('name="Room Summary"');
		expect(workbook).toContain('name="Participants"');
		expect(workbook).toContain('name="Questions"');
		expect(workbook).toContain('name="Answer Details"');
		expect(workbook).toContain('name="Leaderboard"');
		expect(sheets.every((sheet) => sheet?.includes('state="frozen"'))).toBe(true);
		expect(sheets.every((sheet) => sheet?.includes('<autoFilter'))).toBe(true);
		expect(sheets[0]).toContain('ชีววิทยา: Cells?');
		expect(sheets[0]).toContain('AB/CD');
		expect(sheets[2]).toContain('&apos;=What is ATP?');
		expect(sheets[3]).toContain('&apos;@test');
		expect(sheets[4]).toContain('&apos;+cmd');
		expect(await archive.file('docProps/core.xml')?.async('string')).toContain(
			'<dc:creator>SE Quiz</dc:creator>'
		);
		expect(await archive.file('docProps/app.xml')?.async('string')).toContain(
			'<Application>SE Quiz</Application>'
		);
	});

	it('uses correctness totals when the game hid point scoring', async () => {
		const archive = await JSZip.loadAsync(
			await reportToXlsx({ ...report, scoreMode: 'correctness' })
		);
		const participants = await archive.file('xl/worksheets/sheet2.xml')?.async('string');

		expect(participants).toContain('<c r="J2" s="4"><v>1</v></c>');
	});
});

describe('Excel export safety', () => {
	it('neutralizes every formula prefix', () => {
		for (const value of ['=SUM(A1:A2)', '+cmd', '-1+1', '@test', '  =hidden']) {
			expect(safeExcelString(value)).toBe(`'${value}`);
		}
		expect(safeExcelString('ordinary')).toBe('ordinary');
	});

	it('sanitizes the room code and title in the recommended filename', () => {
		expect(reportXlsxFileName(report)).toBe('SE-Quiz_AB_CD_ชีววิทยา_ Cells__2026-09-13_03-04.xlsx');
	});
});
