import type { SQL } from 'bun';
import type { BaseBlobStorage } from '../blob/base';
import type { InternalFuiz } from '../storage';
import { accountFromRow } from './accounts';
import { PostgresPrivateResourceStore } from './privateResourcesPostgres';
import { validateRecord } from './privateValidation';

type DemoSlide = InternalFuiz['config']['slides'][number];

// A self-contained pin board; no external image URLs or public-library ownership.
const pinBoard = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400">
<rect width="800" height="400" fill="#f8fafc"/>
<g stroke="#334155" stroke-width="3">
<rect x="40" y="120" width="200" height="160" rx="16" fill="#dbeafe"/>
<rect x="300" y="120" width="200" height="160" rx="16" fill="#dcfce7"/>
<rect x="560" y="120" width="200" height="160" rx="16" fill="#fef3c7"/>
<path d="M245 200h45m-10-10 10 10-10 10M505 200h45m-10-10 10 10-10 10" fill="none"/>
</g>
<g font-family="sans-serif" font-size="28" fill="#0f172a" text-anchor="middle">
<text x="400" y="65">Web Application</text>
<text x="140" y="210">Browser</text><text x="400" y="210">API</text><text x="660" y="210">Database</text>
</g></svg>`;

export const demoPinMedia = {
	hash: 'se-quiz-demo-pin-board-v1',
	value: {
		Image: {
			Base64: {
				data: `data:image/svg+xml;base64,${Buffer.from(pinBoard).toString('base64')}`,
				alt: ''
			}
		}
	}
};

const pinMedia = {
	Image: {
		HashReference: {
			hash: demoPinMedia.hash,
			alt: 'แผนภาพเว็บแอปพลิเคชัน: Browser ด้านซ้าย ส่งคำขอไปยัง API ตรงกลาง ซึ่งเชื่อมต่อ Database ด้านขวา'
		}
	}
};

const scale = (title: string): DemoSlide => ({
	Scale: {
		title,
		introduce_question: 5000,
		time_limit: null,
		points_awarded: 0,
		min: 1,
		max: 5,
		style: 'Agreement',
		labels: { low: '1 = น้อยที่สุด', mid: '3 = ปานกลาง', high: '5 = มากที่สุด' }
	}
});

const openEnded = (title: string): DemoSlide => ({
	FreeText: {
		title,
		introduce_question: 5000,
		time_limit: null,
		points_awarded: 0,
		mode: 'OpenEnded',
		max_entries: 1,
		max_entry_length: 200
	}
});

const multipleChoice = (title: string, answers: [string, boolean][]): DemoSlide => ({
	MultipleChoice: {
		title,
		answer_mode: 'SingleAnswer',
		introduce_question: 5000,
		time_limit: 60000,
		points_awarded: 1000,
		answers: answers.map(([Text, correct]) => ({ content: { Text }, correct }))
	}
});

const trueFalse = (title: string, correct: boolean): DemoSlide =>
	multipleChoice(title, [
		['ถูก', correct],
		['ผิด', !correct]
	]);

const typeAnswer = (title: string, answers: string[]): DemoSlide => ({
	TypeAnswer: {
		title,
		introduce_question: 5000,
		time_limit: 60000,
		points_awarded: 1000,
		case_sensitive: false,
		answers
	}
});

const slider = (title: string, correct: number, max: number, unit: string): DemoSlide => ({
	Slider: {
		title,
		introduce_question: 5000,
		time_limit: 120000,
		points_awarded: 1000,
		range: { min: 0, max, step: 1 },
		correct,
		tolerance: 0,
		unit
	}
});

const pin = (title: string, target: 'Browser' | 'API' | 'Database' | null): DemoSlide => ({
	Pin: {
		title,
		media: pinMedia,
		introduce_question: 5000,
		time_limit: 60000,
		points_awarded: target ? 1000 : 0,
		correct_area: target
			? {
					Rectangle: {
						x: { Browser: 0.05, API: 0.375, Database: 0.7 }[target],
						y: 0.3,
						width: 0.25,
						height: 0.4
					}
				}
			: null
	}
});

const order = (title: string, answers: string[]): DemoSlide => ({
	Order: {
		title,
		introduce_question: 5000,
		time_limit: 120000,
		points_awarded: 1000,
		axis_labels: { from: 'เริ่มต้น', to: 'สิ้นสุด' },
		answers
	}
});

const poll = (title: string, answers: string[]): DemoSlide => ({
	Poll: {
		title,
		introduce_question: 5000,
		time_limit: 60000,
		points_awarded: 0,
		answers: answers.map((Text) => ({ Text }))
	}
});

const nps = (title: string): DemoSlide => ({
	Scale: {
		title,
		introduce_question: 5000,
		time_limit: null,
		points_awarded: 0,
		min: 0,
		max: 10,
		style: 'Nps',
		labels: { low: 'ไม่แนะนำเลย', high: 'แนะนำอย่างแน่นอน' }
	}
});

const wordCloud = (title: string): DemoSlide => ({
	FreeText: {
		title,
		introduce_question: 5000,
		time_limit: 60000,
		points_awarded: 0,
		mode: 'WordCloud',
		max_entries: 3,
		max_entry_length: 40
	}
});

const brainstorm = (title: string): DemoSlide => ({
	Brainstorm: {
		title,
		introduce_question: 5000,
		idea_time_limit: 120000,
		vote_time_limit: 60000,
		points_awarded: 0,
		max_ideas_per_player: 3,
		max_votes_per_player: 3,
		max_idea_length: 200
	}
});

const info = (title: string, body: string): DemoSlide => ({
	InfoSlide: { title, body, duration: null }
});

const game = (uniqueId: string, title: string, slides: DemoSlide[]): InternalFuiz => ({
	uniqueId,
	versionId: 0,
	lastEdited: Date.UTC(2026, 9, 2),
	config: { title, slides }
});

// Stable IDs identify the fourteen game types; each now contains six undergraduate SE activities.
// The separate satisfaction survey stays at two questions.
export const demoGames: InternalFuiz[] = [
	game('20000000-0000-4000-8000-000000000001', 'Software Engineering: ปรนัย (Multiple Choice)', [
		multipleChoice('ข้อใดเป็น Functional Requirement ของระบบยืมอุปกรณ์มหาวิทยาลัย?', [
			['ระบบต้องตอบกลับภายใน 2 วินาที', false],
			['นักศึกษาสามารถยกเลิกคำขอยืมก่อนอนุมัติได้', true],
			['ระบบต้องพร้อมใช้งาน 99.9%', false],
			['หน้าเว็บต้องรองรับผู้ใช้พร้อมกัน 500 คน', false]
		]),
		multipleChoice('ใน Scrum ใครรับผิดชอบการจัดลำดับรายการใน Product Backlog?', [
			['Scrum Master', false],
			['ผู้บริหารมหาวิทยาลัย', false],
			['Product Owner', true],
			['ผู้ทดสอบซอฟต์แวร์', false]
		]),
		multipleChoice('ทีมแก้การคำนวณส่วนลดแล้ว ควรทำอะไรเพื่อตรวจว่าฟังก์ชันเดิมยังทำงานถูกต้อง?', [
			['รัน Regression Test ที่เกี่ยวข้อง', true],
			['เปลี่ยนชื่อฟังก์ชันทั้งหมด', false],
			['ตรวจเฉพาะสีของปุ่ม', false],
			['ลบ Test เดิมเพื่อให้ Build เร็วขึ้น', false]
		]),
		multipleChoice(
			'ทีม 4 คนมีเวลา 12 สัปดาห์ ขอบเขตระบบยังเปลี่ยนบ่อย และยังไม่ต้องขยายแต่ละบริการแยกกัน ควรเริ่มออกแบบอย่างไร?',
			[
				['แยกทุกฟังก์ชันเป็น Microservice ทันที', false],
				['ใช้ฐานข้อมูลหลายชนิดเพื่อเผื่ออนาคต', false],
				['รวมทุกอย่างไว้ในไฟล์เดียวเพื่อแก้เร็ว', false],
				['เริ่มจาก Modular Monolith ที่แบ่งขอบเขตโมดูลชัดเจน', true]
			]
		),
		multipleChoice(
			'มีสมาชิกเพียงคนเดียวที่ Deploy ระบบได้ และอาจไม่ว่างวันส่งงาน วิธีลดความเสี่ยงที่เหมาะสมคืออะไร?',
			[
				['ขอให้คนนั้นรับปากว่าจะไม่ขาด', false],
				['จัดทำคู่มือและให้สมาชิกสำรองทดลอง Deploy จริง', true],
				['ยกเลิกการทดสอบก่อน Deploy', false],
				['รอให้เกิดปัญหาแล้วค่อยหาคนแทน', false]
			]
		),
		multipleChoice('API นำคำค้นของผู้ใช้มาต่อใน SQL โดยตรง แม้หน้าเว็บตรวจอักขระแล้ว ควรแก้จุดใดเป็นหลัก?', [
			['ซ่อนช่องค้นหาจากหน้าเว็บ', false],
			['เพิ่มความยาวรหัสผ่านฐานข้อมูลอย่างเดียว', false],
			['ใช้ Parameterized Query ฝั่งเซิร์ฟเวอร์', true],
			['ตรวจเฉพาะคำว่า SELECT ใน Browser', false]
		])
	]),
	game('20000000-0000-4000-8000-000000000002', 'Software Engineering: ถูกหรือผิด (True / False)', [
		trueFalse('Sprint Retrospective ใช้ทบทวนและปรับปรุงวิธีทำงานของทีม', true),
		trueFalse('Microservices ทำให้ทุกโครงการพัฒนาและดูแลระบบง่ายกว่า Monolith เสมอ', false),
		trueFalse('Acceptance Criteria ที่ตรวจสอบได้ช่วยให้ทีมและผู้ใช้เข้าใจตรงกันว่างานผ่านเกณฑ์เมื่อใด', true),
		trueFalse('ถ้า Automated Test ผ่านทั้งหมด เราสรุปได้ว่าไม่มีข้อผิดพลาดในกรณีที่ยังไม่ได้ทดสอบ', false),
		trueFalse('เมื่อโครงการล่าช้า การเพิ่มสมาชิกใหม่จะทำให้งานเสร็จเร็วขึ้นทันทีเสมอ', false),
		trueFalse(
			'ผู้ใช้เข้าสู่ระบบสำเร็จแล้ว API ยังต้องตรวจสิทธิ์เข้าถึงข้อมูลแต่ละรายการ เช่น รายงานของเจ้าของคนอื่น',
			true
		)
	]),
	game('20000000-0000-4000-8000-000000000003', 'Software Engineering: พิมพ์คำตอบ (Type Answer)', [
		typeAnswer('เครื่องมือควบคุมเวอร์ชันที่มีคำสั่ง git commit และ git branch ชื่ออะไร?', ['Git']),
		typeAnswer('บน GitHub คำขอให้เพื่อนตรวจโค้ดก่อนรวม Branch ย่อเป็นอักษรอังกฤษ 2 ตัวว่าอะไร?', ['PR']),
		typeAnswer('ภาษามาตรฐานที่ใช้ SELECT ข้อมูลจากฐานข้อมูลเชิงสัมพันธ์ ย่อเป็นอักษรอังกฤษ 3 ตัวว่าอะไร?', ['SQL']),
		typeAnswer(
			'เอกสารที่บันทึกบริบท ทางเลือก และเหตุผลของการตัดสินใจเชิงสถาปัตยกรรมหนึ่งเรื่อง นิยมย่อเป็นอักษรอังกฤษ 3 ตัวว่าอะไร?',
			['ADR']
		),
		typeAnswer(
			'แนวปฏิบัติที่รวมโค้ดเข้าด้วยกันเป็นประจำและตรวจด้วย Build/Test อัตโนมัติ นิยมย่อเป็นอักษรอังกฤษ 2 ตัวว่าอะไร?',
			['CI']
		),
		typeAnswer('ระหว่าง RPO กับ RTO ค่าใดหมายถึงช่วงเวลาสูงสุดของข้อมูลที่ยอมสูญเสียย้อนหลังได้เมื่อกู้ระบบ? ตอบตัวย่อ', [
			'RPO'
		])
	]),
	game('20000000-0000-4000-8000-000000000004', 'Software Engineering: คำนวณและประเมิน (Slider)', [
		slider('Test ผ่าน 18 กรณีจากทั้งหมด 20 กรณี คิดเป็นกี่เปอร์เซ็นต์?', 90, 100, '%'),
		slider(
			'Backlog เหลือ 60 Story Points สมมติทีมทำได้คงที่ 20 Points ต่อ Sprint และไม่มีงานเพิ่ม ต้องใช้อีกกี่ Sprint?',
			3,
			10,
			'Sprint'
		),
		slider('สมาชิก 3 คนทำงานคนละ 4 ชั่วโมง รวมเป็นความพยายามกี่คน-ชั่วโมง?', 12, 24, 'คน-ชั่วโมง'),
		slider(
			'ความเสี่ยงมีโอกาสเกิด 25% และเสียหาย 80,000 บาท ค่าความเสียหายคาดหมาย = โอกาส × ผลกระทบ เท่ากับกี่พันบาท?',
			20,
			100,
			'พันบาท'
		),
		slider(
			'พบข้อบกพร่องก่อน Release 36 จุด และหลัง Release อีก 4 จุด จากที่พบทั้งหมด ทีมตรวจเจอก่อน Release กี่เปอร์เซ็นต์?',
			90,
			100,
			'%'
		),
		slider(
			'งาน A ใช้ 2 วัน จากนั้น B (5 วัน) กับ C (3 วัน) ทำขนานกันได้ งาน D (2 วัน) เริ่มได้เมื่อ B และ C เสร็จทั้งหมด โครงการใช้เวลาเร็วสุดกี่วัน?',
			9,
			20,
			'วัน'
		)
	]),
	game(
		'20000000-0000-4000-8000-000000000005',
		'Software Engineering: วิเคราะห์โครงสร้าง (Pin Answer)',
		[
			pin('ปักหมุดส่วนที่แสดงหน้าเว็บและรับการคลิกของผู้ใช้ในภาพ', 'Browser'),
			pin('กำหนดให้กฎธุรกิจอยู่ฝั่ง API ปักหมุดส่วนที่ต้องตรวจว่านักศึกษามีสิทธิ์ลงทะเบียนวิชานี้ก่อนบันทึกข้อมูล', 'API'),
			pin('ปักหมุดส่วนที่จัดเก็บข้อมูลการลงทะเบียนอย่างถาวร', 'Database'),
			pin(
				'ผู้โจมตีข้าม JavaScript ใน Browser และส่งคำขอเองได้ ปักหมุดส่วนที่รับคำขอ HTTP และต้องตรวจสิทธิ์ซ้ำก่อนเรียกฐานข้อมูล',
				'API'
			),
			pin('ตรวจพบว่าคำสั่ง SQL ค้นหารหัสนักศึกษาช้าเพราะไม่มี Index ปักหมุดส่วนที่ต้องเพิ่ม Index', 'Database'),
			pin(
				'คำขอสองรายการผ่าน API มาพร้อมกัน ทีมต้องใช้ UNIQUE Constraint ป้องกันรหัสนักศึกษาซ้ำ ปักหมุดส่วนที่บังคับ Constraint นี้',
				'Database'
			)
		]
	),
	game('20000000-0000-4000-8000-000000000006', 'Software Engineering: เรียงกระบวนการ (Puzzle)', [
		order('เรียงช่วงหลักของ Waterfall ตามแบบจำลองพื้นฐาน จากเริ่มต้นไปสิ้นสุด', [
			'วิเคราะห์ความต้องการ',
			'ออกแบบระบบ',
			'เขียนโปรแกรม',
			'ทดสอบระบบ'
		]),
		order('ทีมใช้ Pull Request และต้อง Review ผ่านก่อน Merge เรียงขั้นตอนตั้งแต่เริ่มแก้โค้ดจนรวมงาน', [
			'สร้าง Feature Branch',
			'แก้โค้ดและ Commit',
			'เปิด Pull Request',
			'ผ่านการ Review',
			'Merge เข้า Branch หลัก'
		]),
		order('เรียงกระบวนการจัดการความเสี่ยงหนึ่งรายการตั้งแต่พบปัญหาที่อาจเกิดจนติดตามผล', [
			'ระบุความเสี่ยง',
			'ประเมินโอกาสและผลกระทบ',
			'เลือกมาตรการและผู้รับผิดชอบ',
			'ดำเนินมาตรการ',
			'ติดตามความเสี่ยงที่เหลือ'
		]),
		order('เปลี่ยนคอลัมน์โดยให้ระบบอ่านได้ทั้งรูปแบบเก่าและใหม่ เรียงขั้นตอนให้ลบคอลัมน์เก่าได้อย่างปลอดภัย', [
			'เพิ่มคอลัมน์ใหม่ที่ยอมให้ว่าง',
			'Deploy โค้ดที่รองรับทั้งสองรูปแบบ',
			'ย้ายข้อมูลเดิมไปคอลัมน์ใหม่',
			'ยืนยันว่าข้อมูลครบและไม่มีโค้ดเก่าใช้งาน',
			'ลบคอลัมน์เก่า'
		]),
		order('ทีมต้องมี Regression Test สำหรับ Bug นี้ก่อนปล่อยแก้ไข เรียงขั้นตอนการแก้ Bug', [
			'ทำซ้ำอาการที่รายงาน',
			'เขียน Test ที่ล้มเหลวเพราะ Bug',
			'แก้สาเหตุในโค้ด',
			'รัน Test ใหม่และ Test ที่เกี่ยวข้อง',
			'ปล่อยรุ่นแก้ไข'
		]),
		order(
			'ระบบเก่าต้องหยุดเขียนระหว่าง Migration และต้องทดสอบก่อนเปิดใช้ เรียงแผนที่มีการตรวจความพร้อมของ Backup ไว้ล่วงหน้า',
			[
				'ทดสอบว่า Backup กู้คืนได้',
				'เปิดช่วงบำรุงรักษาและหยุดการเขียน',
				'สำรองข้อมูลล่าสุดแล้วทำ Migration',
				'ตรวจข้อมูลและทดสอบระบบ',
				'เปิดรับการเขียนตามปกติ'
			]
		)
	]),
	game('20000000-0000-4000-8000-000000000007', 'Software Engineering: ตัดสินใจร่วมกัน (Poll)', [
		poll('ทีมโครงงานมีเวลาประชุมร่วมกันจำกัด คุณอยากทดลองวิธีติดตามงานแบบใดก่อน? ไม่มีเฉลยตายตัว', [
			'อัปเดตสั้น ๆ ผ่านข้อความทุกวัน',
			'ประชุมสั้นเป็นเวลาแน่นอน',
			'ใช้บอร์ดงานพร้อมระบุสิ่งติดขัด',
			'จับคู่ติดตามงานเป็นรายสัปดาห์'
		]),
		poll('ระบบยืมอุปกรณ์รุ่นแรกมีเวลาพัฒนาจำกัด คุณอยากหารือกับผู้ใช้เพื่อจัดลำดับเรื่องใดก่อน?', [
			'ขั้นตอนยืมและคืน',
			'การค้นหาอุปกรณ์',
			'รายงานสำหรับเจ้าหน้าที่',
			'การแจ้งเตือนผู้ยืม'
		]),
		poll('ทีมยังไม่เคยออกแบบระบบขนาดกลาง ประเด็นใดของสถาปัตยกรรมที่คุณอยากทำ Prototype เพื่อเรียนรู้ก่อน?', [
			'ขอบเขตโมดูล',
			'รูปแบบข้อมูล',
			'การสื่อสารระหว่างส่วน',
			'วิธี Deploy และติดตามระบบ'
		]),
		poll('ก่อนวันนำเสนอ คุณกังวลความเสี่ยงใดมากที่สุดสำหรับทีมของคุณ?', [
			'บริการภายนอกใช้ไม่ได้',
			'สมาชิกสำคัญไม่ว่าง',
			'ข้อมูลตัวอย่างไม่พร้อม',
			'การเปลี่ยน Requirement ในนาทีสุดท้าย'
		]),
		poll('หากเลือกลงทุนเพิ่มด้านคุณภาพได้หนึ่งเรื่องในสัปดาห์นี้ คุณอยากเลือกเรื่องใดเพื่อหารือกับทีม?', [
			'Automated Test',
			'Code Review',
			'ทดสอบกับผู้ใช้จริง',
			'ปรับปรุง Monitoring'
		]),
		poll('ทีมต้องส่งต่อระบบให้รุ่นน้อง เอกสารใดที่คุณคิดว่าทีมคุณขาดมากที่สุด?', [
			'คู่มือติดตั้งและ Deploy',
			'เหตุผลการออกแบบระบบ',
			'โครงสร้างข้อมูลและ API',
			'ปัญหาที่รู้แล้วและแผนรับมือ'
		])
	]),
	game('20000000-0000-4000-8000-000000000008', 'Software Engineering: ประเมินความพร้อม (Scale)', [
		scale('คุณมั่นใจในการอธิบาย Functional และ Non-functional Requirements มากน้อยเพียงใด?'),
		scale('คุณมั่นใจในการแบ่งงานตามความถนัดโดยไม่ให้ความรู้กระจุกที่คนเดียวมากน้อยเพียงใด?'),
		scale('คุณมั่นใจในการอธิบายเหตุผลที่แบ่งระบบออกเป็นแต่ละโมดูลมากน้อยเพียงใด?'),
		scale('คุณมั่นใจในการประเมินโอกาสเกิดและผลกระทบของความเสี่ยงโครงงานมากน้อยเพียงใด?'),
		scale('คุณมั่นใจในการเลือก Test Cases ที่ครอบคลุมกรณีผิดพลาดและค่าขอบเขตมากน้อยเพียงใด?'),
		scale('คุณมั่นใจในการเตรียมแผนสำรองและตรวจระบบหลัง Deploy มากน้อยเพียงใด?')
	]),
	game('20000000-0000-4000-8000-000000000009', 'Software Engineering: แนะนำแนวปฏิบัติ (NPS)', [
		nps('จากประสบการณ์โครงงาน คุณมีแนวโน้มแนะนำการใช้ Git และ Pull Request ให้ทีมรุ่นน้องเพียงใด?'),
		nps('จากประสบการณ์ทำงานเป็นทีม คุณมีแนวโน้มแนะนำ Retrospective หลังแต่ละรอบงานเพียงใด?'),
		nps('หลังเรียนเรื่องสถาปัตยกรรม คุณมีแนวโน้มแนะนำให้ทีมบันทึกเหตุผลการออกแบบด้วย ADR เพียงใด?'),
		nps('หลังเรียนเรื่องความเสี่ยง คุณมีแนวโน้มแนะนำให้ทีมทบทวน Risk Register เป็นประจำเพียงใด?'),
		nps('จากประสบการณ์ทดสอบ คุณมีแนวโน้มแนะนำให้ทีมรัน Automated Test ผ่าน CI เพียงใด?'),
		nps('หลังเรียนเรื่องการส่งมอบ คุณมีแนวโน้มแนะนำให้ทีมซ้อมกู้คืน Backup ก่อนใช้งานจริงเพียงใด?')
	]),
	game(
		'20000000-0000-4000-8000-000000000010',
		'Software Engineering: มองระบบจากหลายมุม (Drop Pin)',
		[
			pin('ปักหมุดส่วนที่คุณอยากรับผิดชอบในโครงงาน แล้วอธิบายเหตุผลกับทีม ไม่มีตำแหน่งถูกผิด', null),
			pin('ปักหมุดส่วนที่คุณมั่นใจในการเขียน Test น้อยที่สุด เพื่อวางแผนเรียนรู้ร่วมกัน', null),
			pin('ระบบตอบช้าแต่ยังไม่มีข้อมูลวัด ปักหมุดส่วนที่คุณอยากเริ่มตรวจสอบ แล้วบอกว่าจะเก็บหลักฐานอะไร', null),
			pin('ปักหมุดส่วนที่คุณอยากทบทวนความเสี่ยงด้านความปลอดภัยก่อน แล้วอธิบายสมมติฐานของคุณ', null),
			pin('เมื่อ Requirement เปลี่ยน ปักหมุดส่วนที่คุณกังวลว่าจะได้รับผลกระทบมากที่สุด แล้วเสนอสิ่งที่ต้องตรวจ', null),
			pin('ทีมต้องส่งต่อระบบ ปักหมุดส่วนที่คุณคิดว่าควรเพิ่มเอกสารหรือแบ่งปันความรู้ก่อน', null)
		]
	),
	game('20000000-0000-4000-8000-000000000011', 'Software Engineering: เชื่อมโยงแนวคิด (Word Cloud)', [
		wordCloud('การจัดการทีม: ทีมโครงงานที่ทำงานร่วมกันได้ดีควรมีคุณลักษณะใด? ตอบเป็นคำหรือวลีสั้น ๆ'),
		wordCloud('Requirements: ก่อนเริ่มพัฒนาระบบให้นักศึกษา เราควรถามผู้ใช้งานเรื่องใดบ้าง?'),
		wordCloud('สถาปัตยกรรม: เมื่อนึกถึงระบบที่ดูแลรักษาง่าย คุณนึกถึงคำใดบ้าง?'),
		wordCloud('ความเสี่ยง: ปัจจัยใดอาจทำให้โครงงานส่งไม่ทันหรือใช้งานไม่ได้?'),
		wordCloud('คุณภาพ: นอกจากความถูกต้องแล้ว ซอฟต์แวร์ที่ดีควรมีคุณสมบัติใด?'),
		wordCloud('DevOps: กิจกรรมหรือเครื่องมือใดช่วยให้การส่งมอบซอฟต์แวร์มั่นใจขึ้น?')
	]),
	game(
		'20000000-0000-4000-8000-000000000012',
		'Software Engineering: วิเคราะห์สถานการณ์ (Open Ended)',
		[
			openEnded('เพื่อนส่งงานช้าสองครั้งติดกัน คุณจะเริ่มพูดคุยอย่างไรเพื่อหาสาเหตุโดยไม่กล่าวโทษ? ตอบสั้น ๆ'),
			openEnded('ผู้ใช้บอกว่าอยากได้ระบบที่เร็ว คุณจะถามอะไรเพิ่มเพื่อเปลี่ยนคำว่าเร็วให้เป็นเกณฑ์ตรวจรับที่วัดได้?'),
			openEnded('ระบบรับจำนวนยืมอุปกรณ์ได้ 1–5 ชิ้น ยกตัวอย่างค่าขอบเขตหรือค่าที่ไม่ควรรับพร้อมผลที่คาดหวัง 2 กรณี'),
			openEnded('ทีมเล็กอยากแยก Microservices เพราะดูทันสมัย คุณจะใช้ข้อจำกัดและหลักฐานอะไรประกอบการตัดสินใจ?'),
			openEnded(
				'โครงงานเรียก API ภายนอกที่อาจล่มวันสาธิต เสนอมาตรการลดความเสี่ยงหนึ่งอย่างและแผนสำรองหนึ่งอย่าง'
			),
			openEnded(
				'ผู้ใช้แก้ ID ใน URL แล้วอ่านรายงานของคนอื่นได้ อธิบายจุดที่ต้องตรวจสิทธิ์และ Test ที่ควรเพิ่ม ตอบไม่เกิน 200 ตัวอักษร'
			)
		]
	),
	game(
		'20000000-0000-4000-8000-000000000013',
		'Software Engineering: ระดมแนวทางแก้ปัญหา (Brainstorm)',
		[
			brainstorm('เสนอข้อตกลงทีมที่ช่วยให้งานไม่ตกหล่น แล้วโหวตสิ่งที่ควรเริ่มทำสัปดาห์นี้'),
			brainstorm('ผู้ใช้หลายกลุ่มต้องการฟีเจอร์ต่างกัน เสนอวิธีรวบรวมและจัดลำดับความต้องการ แล้วโหวตวิธีที่ทีมทำได้จริง'),
			brainstorm('เสนอวิธีลด Bug ก่อนส่งงานโดยใช้เวลาเพิ่มไม่เกินหนึ่งวัน แล้วโหวตวิธีที่คุ้มค่าที่สุด'),
			brainstorm(
				'ระบบลงทะเบียนช้ามากในวันเปิดรับ แต่ทีมยังไม่มีผลวัด เสนอวิธีพิสูจน์คอขวดก่อนเปลี่ยนโครงสร้าง แล้วโหวตสิ่งที่ควรตรวจแรก'
			),
			brainstorm(
				'สมาชิกที่รู้ระบบมากที่สุดอาจไม่ว่างก่อนส่งงาน เสนอวิธีกระจายความรู้และแผนสำรอง แล้วโหวตมาตรการที่ทำได้ทัน'
			),
			brainstorm(
				'รุ่นใหม่ต้องเปลี่ยนโครงสร้างข้อมูลและหยุดบริการให้น้อยที่สุด เสนอสิ่งที่ต้องทดสอบหรือเตรียมเพื่อกู้สถานการณ์ แล้วโหวตลำดับสำคัญ'
			)
		]
	),
	game(
		'20000000-0000-4000-8000-000000000014',
		'Software Engineering: สรุปแนวคิดหลายแขนง (Info Slide)',
		[
			info(
				'Requirements: จากความต้องการสู่เกณฑ์ตรวจรับ',
				'Functional Requirement ระบุสิ่งที่ระบบทำ ส่วน Non-functional Requirement ระบุคุณภาพหรือข้อจำกัด เช่น เวลาตอบสนอง แทนที่จะเขียนว่า “ระบบต้องเร็ว” ให้ระบุการกระทำ ภาระงาน และเวลาที่วัดได้ แล้วตกลง Acceptance Criteria กับผู้ใช้'
			),
			info(
				'การจัดการทีม: งานชัดเจนและความรู้ไม่กระจุกตัว',
				'แบ่งงานให้เห็นผลลัพธ์ ผู้รับผิดชอบ และสิ่งที่ต้องรอ ติดตามสิ่งติดขัดอย่างสม่ำเสมอ ใช้ Code Review หรือ Pair Programming เพื่อแบ่งปันความรู้ และใช้ Retrospective เลือกปรับวิธีทำงานทีละเรื่อง โดยไม่ใช้การประชุมเพื่อตำหนิบุคคล'
			),
			info(
				'สถาปัตยกรรม: เลือกให้เหมาะกับข้อจำกัด',
				'พิจารณาขนาดทีม ระยะเวลา ความซับซ้อน และภาระดูแลระบบก่อนเลือกโครงสร้าง Modular Monolith ช่วยแยกขอบเขตภายในโดยยัง Deploy ร่วมกัน ส่วน Microservices เพิ่มอิสระในการ Deploy แต่เพิ่มการสื่อสารข้ามบริการและงานปฏิบัติการ บันทึกบริบท ทางเลือก และผลแลกเปลี่ยนไว้ใน ADR'
			),
			info(
				'ความเสี่ยง: ลดโอกาสเกิดและเตรียมรับผลกระทบ',
				'Risk Register ควรระบุเหตุการณ์ที่อาจเกิด โอกาส ผลกระทบ ผู้รับผิดชอบ และมาตรการรับมือ เช่น ให้คนสำรองทดลอง Deploy เพื่อลดการพึ่งคนเดียว และเตรียมแผนสาธิตเมื่อ API ภายนอกล่ม ทบทวนความเสี่ยงซ้ำเมื่อข้อมูลเปลี่ยน'
			),
			info(
				'คุณภาพและความปลอดภัย: ทดสอบตามความเสี่ยง',
				'ทดสอบทั้งกรณีปกติ ค่าขอบเขต และความล้มเหลว เพิ่ม Regression Test เมื่อแก้ Bug แยกการยืนยันตัวตนออกจากการตรวจสิทธิ์ และตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์ทุกครั้งที่อ่านหรือแก้ทรัพยากร การที่ Test ผ่านไม่ได้พิสูจน์ว่ากรณีที่ยังไม่ได้ทดสอบจะถูกต้อง'
			),
			info(
				'การส่งมอบ: มีแผนกู้คืนที่ลองใช้แล้ว',
				'ใช้ CI ตรวจ Build และ Test ก่อนปล่อยรุ่น เตรียมการเปลี่ยนข้อมูลให้เข้ากันได้กับโค้ดที่ยังใช้งาน ตรวจ Monitoring หลัง Deploy และซ้อมกู้คืน Backup โดย RPO ระบุช่วงข้อมูลย้อนหลังที่ยอมสูญเสีย ส่วน RTO ระบุเวลาที่ตั้งเป้ากู้บริการกลับมา'
			)
		]
	),
	game('20000000-0000-4000-8000-000000000015', 'แบบประเมินความพึงพอใจในการใช้งาน SE Quiz', [
		scale('โดยรวม คุณพึงพอใจในการใช้งาน SE Quiz ระดับใด? (1 = น้อยที่สุด, 5 = มากที่สุด)'),
		openEnded(
			'คุณมีข้อเสนอแนะอะไรเพื่อปรับปรุง SE Quiz? เช่น ความสะดวกในการใช้งาน ปัญหาที่พบ หรือฟีเจอร์ที่อยากให้เพิ่ม'
		)
	])
];

export async function seedDemoGames(sql: SQL, blob: BaseBlobStorage) {
	for (const record of demoGames) validateRecord('creation', record);
	const [row] =
		await sql`SELECT id,email,role,created_at,deleted_at,session_version FROM admins WHERE deleted_at IS NULL AND role IN ('ADMIN','TEACHER') ORDER BY CASE WHEN role='ADMIN' THEN 0 ELSE 1 END,created_at,id LIMIT 1`;
	if (!row) throw new Error('An active teacher or administrator is required for demo games');
	const owner = accountFromRow(row);
	const resources = new PostgresPrivateResourceStore(sql, blob);
	await resources.putMedia(owner, demoPinMedia.hash, demoPinMedia.value);
	return sql.begin(async (tx) => {
		const [current] =
			await tx`SELECT id FROM admins WHERE id=${owner.id} AND session_version=${owner.sessionVersion} AND deleted_at IS NULL AND role IN ('ADMIN','TEACHER') FOR SHARE`;
		if (!current) throw new Error('The demo game owner is no longer active');
		let created = 0;
		for (const record of demoGames) {
			const rows =
				await tx`INSERT INTO host_resources(owner_id,kind,unique_id,version_id,body) VALUES (${owner.id},'creation',${record.uniqueId},${record.versionId},${JSON.stringify(record)}) ON CONFLICT(owner_id,kind,unique_id) DO NOTHING RETURNING unique_id`;
			created += rows.length;
		}
		return { created, total: demoGames.length };
	});
}
