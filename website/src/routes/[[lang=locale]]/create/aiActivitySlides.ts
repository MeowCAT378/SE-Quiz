import {
	type GeneratedActivityDraft,
	type ResolvedActivityGenerationRequest,
	validateActivityDrafts
} from '$lib/ai/activityGeneration';
import { limits } from '$lib/limits';
import type { GenericFuizConfig, GenericSlide, PinShape } from '$lib/types';
import { slideTemplates } from './slideTemplates';

export type PinDraftAttachment<T> = {
	media?: T;
	correctArea?: PinShape;
};

export function validPinTarget(shape: PinShape | undefined): boolean {
	if (!shape || !('Rectangle' in shape)) return false;
	const { x, y, width, height } = shape.Rectangle;
	return (
		[x, y, width, height].every(Number.isFinite) &&
		x >= 0 &&
		y >= 0 &&
		width >= 0.0001 &&
		height >= 0.0001 &&
		x + width <= 1 &&
		y + height <= 1
	);
}

export function validPinImage(media: unknown): boolean {
	if (!media || typeof media !== 'object' || !('Image' in media)) return false;
	const image = media.Image;
	if (!image || typeof image !== 'object' || !('Base64' in image)) return false;
	const base64 = image.Base64;
	return (
		!!base64 &&
		typeof base64 === 'object' &&
		'data' in base64 &&
		typeof base64.data === 'string' &&
		/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(base64.data)
	);
}

function template<T>(key: string, id: number): GenericSlide<T> {
	const found = slideTemplates.find((candidate) => candidate.key === key);
	if (!found) throw new Error('missing_slide_template');
	return found.create(id) as GenericSlide<T>;
}

function nextAvailableId<T>(config: GenericFuizConfig<T>): () => number {
	let next =
		config.slides.reduce((maximum, slide) => {
			let value = Math.max(maximum, slide.id);
			if ('MultipleChoice' in slide) {
				for (const answer of slide.MultipleChoice.answers) value = Math.max(value, answer.id);
			} else if ('Poll' in slide) {
				for (const answer of slide.Poll.answers) {
					value = Math.max(value, answer.id);
				}
			} else if ('TypeAnswer' in slide || 'Order' in slide) {
				const answers = 'TypeAnswer' in slide ? slide.TypeAnswer.answers : slide.Order.answers;
				for (const answer of answers) value = Math.max(value, answer.id);
			}
			return value;
		}, -1) + 1;
	return () => next++;
}

export function appendActivityDrafts<T>(
	config: GenericFuizConfig<T>,
	request: ResolvedActivityGenerationRequest,
	drafts: GeneratedActivityDraft[],
	answerLabels?: [string, string],
	attachments: PinDraftAttachment<T>[] = []
): GenericFuizConfig<T> {
	if (drafts.length < 1) throw new Error('invalid_items');
	const checked = validateActivityDrafts({ ...request, itemCount: drafts.length }, drafts);
	if (config.slides.length + checked.length > limits.fuiz.maxSlidesCount) {
		throw new Error('slide_capacity');
	}
	const id = nextAvailableId(config);
	const generated = checked.map((draft, draftIndex): GenericSlide<T> => {
		if (
			request.activityType === 'multiple_choice' &&
			'question' in draft &&
			'correctIndex' in draft
		) {
			const slide = template<T>('quiz', id());
			if (!('MultipleChoice' in slide)) throw new Error('missing_slide_template');
			slide.MultipleChoice.title = draft.question;
			slide.MultipleChoice.answers = draft.choices.map((choice, index) => ({
				content: { Text: choice },
				correct: index === draft.correctIndex,
				id: id()
			}));
			return slide;
		}
		if (request.activityType === 'true_false' && 'statement' in draft) {
			const slide = template<T>('quiz', id());
			if (!('MultipleChoice' in slide)) throw new Error('missing_slide_template');
			const labels =
				answerLabels ??
				(request.language === 'th'
					? ['จริง', 'เท็จ']
					: request.language === 'en'
						? ['True', 'False']
						: null);
			if (
				!labels ||
				labels.length !== 2 ||
				labels.some((label) => typeof label !== 'string' || !label.trim() || label.length > 500) ||
				labels[0] === labels[1]
			)
				throw new Error('invalid_items');
			slide.MultipleChoice.title = draft.statement;
			slide.MultipleChoice.answers = labels.map((label, index) => ({
				content: { Text: label },
				correct: draft.correct === (index === 0),
				id: id()
			}));
			return slide;
		}
		if (request.activityType === 'poll' && 'question' in draft && 'choices' in draft) {
			const slide = template<T>('poll', id());
			if (!('Poll' in slide)) throw new Error('missing_slide_template');
			slide.Poll.title = draft.question;
			slide.Poll.answers = draft.choices.map((choice) => ({ content: { Text: choice }, id: id() }));
			return slide;
		}
		if (
			(request.activityType === 'word_cloud' || request.activityType === 'open_ended') &&
			'prompt' in draft
		) {
			const slide = template<T>(
				request.activityType === 'word_cloud' ? 'word-cloud' : 'open-ended',
				id()
			);
			if (!('FreeText' in slide)) throw new Error('missing_slide_template');
			slide.FreeText.title = draft.prompt;
			return slide;
		}
		if (request.activityType === 'short_answer' && 'answers' in draft) {
			const slide = template<T>('type-answer', id());
			if (!('TypeAnswer' in slide)) throw new Error('missing_slide_template');
			slide.TypeAnswer.title = draft.question;
			slide.TypeAnswer.answers = draft.answers.map((text) => ({ text, id: id() }));
			return slide;
		}
		if (request.activityType === 'ordering' && 'items' in draft) {
			const slide = template<T>('puzzle', id());
			if (!('Order' in slide)) throw new Error('missing_slide_template');
			slide.Order.title = draft.question;
			slide.Order.answers = draft.items.map((text) => ({ text, id: id() }));
			return slide;
		}
		if (request.activityType === 'slider' && 'range' in draft) {
			const slide = template<T>('slider', id());
			if (!('Slider' in slide)) throw new Error('missing_slide_template');
			Object.assign(slide.Slider, {
				title: draft.question,
				range: { ...draft.range },
				correct: draft.correct,
				tolerance: draft.tolerance,
				unit: draft.unit
			});
			return slide;
		}
		if (
			(request.activityType === 'agreement_scale' || request.activityType === 'nps') &&
			'labels' in draft
		) {
			const slide = template<T>(request.activityType === 'nps' ? 'nps' : 'scale', id());
			if (!('Scale' in slide)) throw new Error('missing_slide_template');
			slide.Scale.title = draft.question;
			slide.Scale.labels = { ...draft.labels };
			return slide;
		}
		if (request.activityType === 'brainstorm' && 'prompt' in draft) {
			const slide = template<T>('brainstorm', id());
			if (!('Brainstorm' in slide)) throw new Error('missing_slide_template');
			slide.Brainstorm.title = draft.prompt;
			return slide;
		}
		if (
			(request.activityType === 'pin_answer' || request.activityType === 'drop_pin') &&
			'question' in draft
		) {
			const attachment = attachments[draftIndex];
			if (!validPinImage(attachment?.media)) throw new Error('invalid_image');
			if (request.activityType === 'pin_answer' && !validPinTarget(attachment?.correctArea))
				throw new Error('invalid_target');
			const slide = template<T>(
				request.activityType === 'pin_answer' ? 'pin-answer' : 'drop-pin',
				id()
			);
			if (!('Pin' in slide)) throw new Error('missing_slide_template');
			slide.Pin.title = draft.question;
			slide.Pin.media = attachment.media;
			slide.Pin.correct_area =
				request.activityType === 'pin_answer' ? structuredClone(attachment.correctArea) : null;
			return slide;
		}
		throw new Error('invalid_items');
	});
	return { ...config, slides: [...config.slides, ...generated] };
}
