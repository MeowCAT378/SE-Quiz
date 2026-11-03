<script lang="ts">
	import { tick } from 'svelte';
	import { SvelteDate } from 'svelte/reactivity';
	import { parseListDate } from '$lib/listFilters';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import CalendarMonth from '~icons/material-symbols/calendar-month-outline';
	import ChevronLeft from '~icons/material-symbols/chevron-left';
	import ChevronRight from '~icons/material-symbols/chevron-right';

	let {
		label,
		value = $bindable(''),
		invalid = false,
		describedBy
	}: {
		label: string;
		value?: string;
		invalid?: boolean;
		describedBy?: string;
	} = $props();
	const id = $props.id();
	let trigger: HTMLButtonElement;
	let calendar: HTMLDivElement;
	let open = $state(false);
	let activeTime = $state(Date.now());
	const active = $derived(new Date(activeTime));
	let today = $state('');
	const selected = $derived(parseListDate(value));
	const locale = $derived(getLocale());
	const monthFormat = $derived(
		new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', calendar: 'gregory' })
	);
	const dayFormat = $derived(
		new Intl.DateTimeFormat(locale, { dateStyle: 'full', calendar: 'gregory' })
	);
	const weekdayFormat = $derived(new Intl.DateTimeFormat(locale, { weekday: 'short' }));
	const days = $derived.by(() => {
		const first = new SvelteDate(active.getTime());
		first.setDate(1);
		const offset = (first.getDay() + 6) % 7;
		const last = new SvelteDate(active.getTime());
		last.setMonth(last.getMonth() + 1, 0);
		const length = Math.ceil((offset + last.getDate()) / 7) * 7;
		first.setDate(1 - offset);
		return Array.from({ length }, (_, index) => {
			const day = new SvelteDate(first.getTime());
			day.setDate(first.getDate() + index);
			return day;
		});
	});

	function dateKey(date: Date) {
		return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	}

	function close() {
		calendar.hidePopover();
		trigger.focus({ preventScroll: true });
	}

	function pick(date: Date | null) {
		value = date ? dateKey(date).split('-').reverse().join('/') : '';
		close();
	}

	async function focusDay() {
		await tick();
		calendar.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus({ preventScroll: true });
	}

	function moveMonth(amount: number) {
		const next = new SvelteDate(active.getTime());
		next.setDate(1);
		next.setMonth(next.getMonth() + amount);
		const last = new SvelteDate(next.getTime());
		last.setMonth(last.getMonth() + 1, 0);
		next.setDate(Math.min(active.getDate(), last.getDate()));
		if (next.getFullYear() >= 1 && next.getFullYear() <= 9999) activeTime = next.getTime();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close();
			return;
		}
		if (!(event.target instanceof HTMLElement) || !event.target.matches('.day')) return;
		const weekday = (active.getDay() + 6) % 7;
		const rtl = getComputedStyle(calendar).direction === 'rtl';
		const offset = {
			ArrowLeft: rtl ? 1 : -1,
			ArrowRight: rtl ? -1 : 1,
			ArrowUp: -7,
			ArrowDown: 7,
			Home: -weekday,
			End: 6 - weekday
		}[event.key];
		if (offset !== undefined) {
			event.preventDefault();
			const next = new SvelteDate(active.getTime());
			next.setDate(next.getDate() + offset);
			if (next.getFullYear() >= 1 && next.getFullYear() <= 9999) activeTime = next.getTime();
		} else if (event.key === 'PageUp' || event.key === 'PageDown') {
			event.preventDefault();
			moveMonth((event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1));
		} else return;
		void focusDay();
	}
</script>

<div class="date-field">
	<label for={id}>{label}</label>
	<div class="control" style:anchor-name="--{id}">
		<input
			{id}
			type="text"
			lang={getLocale()}
			placeholder={m.list_date_placeholder()}
			bind:value
			aria-invalid={invalid || parseListDate(value) === null}
			aria-describedby={describedBy}
			autocomplete="off"
		/>
		<button bind:this={trigger} class="trigger" type="button" aria-label={m.list_date_pick({ label })} aria-haspopup="dialog" aria-expanded={open} aria-controls="{id}-calendar" popovertarget="{id}-calendar">
			<CalendarMonth aria-hidden="true" />
		</button>
	</div>

<div
	bind:this={calendar}
	id="{id}-calendar"
	class="calendar"
	popover="auto"
	role="dialog"
	tabindex="-1"
	aria-label={m.list_date_pick({ label })}
	style:position-anchor="--{id}"
	onbeforetoggle={(event) => {
		if ((event as ToggleEvent).newState === 'open') {
			today = dateKey(new SvelteDate());
			activeTime = new Date(`${selected || today}T12:00:00`).getTime();
		}
	}}
	ontoggle={(event) => {
		open = (event as ToggleEvent).newState === 'open';
		if (open) void focusDay();
	}}
	onfocusout={(event) => {
		if (event.relatedTarget instanceof Node && !calendar.contains(event.relatedTarget)) calendar.hidePopover();
	}}
	onkeydown={onKeydown}
>
	<div class="calendar-header">
		<button type="button" class="month-step" aria-label={m.list_date_previous_month()} disabled={active.getFullYear() === 1 && active.getMonth() === 0} onclick={() => moveMonth(-1)}><ChevronLeft aria-hidden="true" /></button>
		<strong id="{id}-month" aria-live="polite">{monthFormat.format(active)}</strong>
		<button type="button" class="month-step" aria-label={m.list_date_next_month()} disabled={active.getFullYear() === 9999 && active.getMonth() === 11} onclick={() => moveMonth(1)}><ChevronRight aria-hidden="true" /></button>
	</div>
	<div role="grid" aria-labelledby="{id}-month">
		<div class="week" role="row">
			{#each days.slice(0, 7) as day (day.getDay())}
				<span class="weekday" role="columnheader" aria-label={day.toLocaleDateString(locale, { weekday: 'long' })}>{weekdayFormat.format(day)}</span>
			{/each}
		</div>
		{#each Array.from({ length: days.length / 7 }, (_, index) => index) as week (week)}
			<div class="week" role="row">
				{#each days.slice(week * 7, week * 7 + 7) as day (dateKey(day))}
					<button type="button" class="day" class:outside={day.getMonth() !== active.getMonth()} class:today={dateKey(day) === today} role="gridcell" tabindex={dateKey(day) === dateKey(active) ? 0 : -1} aria-label={dayFormat.format(day)} aria-selected={dateKey(day) === selected} aria-current={dateKey(day) === today ? 'date' : undefined} disabled={day.getFullYear() < 1 || day.getFullYear() > 9999} onclick={() => pick(day)}>{day.getDate()}</button>
				{/each}
			</div>
		{/each}
	</div>
	<div class="calendar-footer">
		<button type="button" onclick={() => pick(null)}>{m.clear_selection()}</button>
		<button type="button" class="today-action" onclick={() => pick(new SvelteDate())}>{m.list_date_today()}</button>
	</div>
</div>
</div>

<style>
	.date-field { display: grid; gap: 0.35rem; min-width: 0; flex: 1; font-size: 1rem; }
	.control { position: relative; }
	input[type='text'] { box-sizing: border-box; width: 100%; min-width: 0; min-height: 44px; padding: 0.5rem; padding-inline-end: 44px; font: inherit; color: inherit; background: var(--surface); border: 1px solid var(--outline); border-radius: 0.5em; }
	input::placeholder { color: var(--on-surface-variant); opacity: 1; }
	button { display: grid; place-items: center; min-height: 44px; padding: 0; font: inherit; color: inherit; background: transparent; border: 1px solid transparent; border-radius: 0.5em; cursor: pointer; }
	.trigger { position: absolute; inset-inline-end: 0; inset-block-start: 0; width: 44px; height: 100%; color: var(--on-surface-variant); }
	button:hover:not(:disabled), .trigger[aria-expanded='true'] { background: var(--surface-variant); color: var(--on-surface); }
	input:hover, .control:focus-within input { border-color: var(--primary); }
	input[aria-invalid='true'] { border-color: var(--primary); }
	input:focus-visible, button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
	.calendar { position: fixed; inset: 0; margin: auto; box-sizing: border-box; width: 18.5rem; max-width: calc(100vw - 1.5rem); max-height: calc(100dvh - 2rem); overflow: auto; padding: 0.5rem; border: 1px solid var(--outline); border-radius: 0.7em; font: inherit; font-size: 0.875rem; color: var(--on-surface); background: var(--surface); box-shadow: 0 2px 4px color-mix(in srgb, var(--on-surface) 8%, transparent), 0 8px 20px color-mix(in srgb, var(--on-surface) 12%, transparent); overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--outline) transparent; }
	.calendar button { min-height: 32px; }
	.calendar::backdrop { background: transparent; }
	.calendar-header { display: grid; grid-template-columns: 32px 1fr 32px; align-items: center; gap: 0.25rem; margin-bottom: 0.25rem; text-align: center; }
	.month-step:dir(rtl) { transform: scaleX(-1); }
	.week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 0.125rem; }
	.weekday { padding: 0.25rem 0; font-size: 0.75rem; color: var(--on-surface-variant); text-align: center; }
	.day { font-variant-numeric: tabular-nums; }
	.day.outside { color: var(--on-surface-variant); }
	.day.today { border-color: var(--primary); font-weight: 700; }
	.day[aria-selected='true'] { background: var(--primary); color: var(--on-primary); font-weight: 700; }
	.day:focus-visible { outline-offset: -3px; }
	.day[aria-selected='true']:focus-visible { outline-color: var(--on-primary); }
	button:disabled { opacity: 0.4; cursor: default; }
	.calendar-footer { display: flex; justify-content: space-between; gap: 0.5rem; border-top: 1px solid var(--outline); margin-top: 0.25rem; padding-top: 0.25rem; }
	.calendar-footer button { padding: 0 0.65rem; }
	.today-action { font-weight: 700; }
	@supports (position-area: bottom span-right) {
		@media (min-width: 40em) and (min-height: 42em) {
			.calendar { inset: unset; margin: 0.5rem 0; position-area: bottom span-right; position-try-fallbacks: flip-block, flip-inline, flip-block flip-inline; }
			.calendar:dir(rtl) { position-area: bottom span-left; }
		}
	}
	@media (pointer: coarse), (max-width: 40em) {
		.calendar { width: 21rem; }
		.calendar button { min-height: 44px; }
		.calendar-header { grid-template-columns: 44px 1fr 44px; }
	}
</style>
