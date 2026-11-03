<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { env } from '$env/dynamic/public';
	import { playIdlessConfig } from '$lib/clientOnly';
	import ConfirmationDialog from '$lib/feedback/ConfirmationDialog.svelte';
	import LoadingCircle from '$lib/feedback/LoadingCircle.svelte';
	import JoinForm from '$lib/game/JoinForm.svelte';
	import { canCreate, canManageActiveGame, type LiveRoom, liveRooms } from '$lib/homepageAccess';
	import Footer from '$lib/layout/Footer.svelte';
	import MainHeader from '$lib/layout/MainHeader.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { addCreation, getAllCreations, getCreation, loadDatabase } from '$lib/storage';
	import { storageErrorMessage } from '$lib/storage/feedback';
	import type { PublishedFuiz } from '$lib/types';
	import FancyAnchorButton from '$lib/ui/FancyAnchorButton.svelte';
	import FancyButton from '$lib/ui/FancyButton.svelte';
	import Add from '~icons/material-symbols/add';
	import DeleteOutline from '~icons/material-symbols/delete-outline';
	import Edit from '~icons/material-symbols/edit-outline';
	import PlayArrow from '~icons/material-symbols/play-arrow';
	import Slideshow from '~icons/material-symbols/slideshow-outline-sharp';
	import StadiaController from '~icons/material-symbols/stadia-controller';
	import StopCircle from '~icons/material-symbols/stop-circle-outline';

	let { data } = $props();

	const title = m.main_title();
	const description = m.main_desc();

	let quizToDelete = $state<string | null>(null);
	let confirmDeleteDialog = $state<ConfirmationDialog>();
	let deleting = $state(false);

	let openingQuizId = $state<string | null>(null);
	let startingQuizId = $state<string | null>(null);

	let quizzesList = $state<PublishedFuiz[]>([]);
	let activeGames = $state<Record<string, string>>({});
	let ownedGameCodes = $state<string[]>([]);
	let games = $state<LiveRoom[]>([]);

	$effect(() => {
		quizzesList = data.quizzes || [];
		activeGames = data.activeGames || {};
		ownedGameCodes = [];
	});

	// Poll active games periodically so regular users see the Join button as soon as admin starts
	$effect(() => {
		const refreshActiveGames = async () => {
			try {
				const res = await fetch(resolve('/api/games/active'));
				if (res.ok) {
					const json = await res.json();
					if (json.activeGames) activeGames = json.activeGames;
					games = Array.isArray(json.games) ? json.games : [];
					ownedGameCodes = Array.isArray(json.ownedGameCodes) ? json.ownedGameCodes : [];
				}
			} catch {
				// Ignore background poll errors
			}
		};
		void refreshActiveGames();
		const interval = setInterval(refreshActiveGames, 3000);

		return () => clearInterval(interval);
	});

	let activeQuizzes = $derived(quizzesList.filter((quiz) => quiz && activeGames[quiz.id]));
	let standaloneRooms = $derived(liveRooms(games, activeGames, quizzesList));

	function askDeleteQuiz(id: string) {
		quizToDelete = id;
		confirmDeleteDialog?.open();
	}

	async function confirmDelete() {
		if (!quizToDelete) return;
		deleting = true;
		try {
			const res = await fetch(resolve('/admin-api/delete'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: quizToDelete })
			});
			if (res.ok) {
				quizzesList = quizzesList.filter((q) => q.id !== quizToDelete);
			}
		} catch (e) {
			console.error('Failed to delete quiz:', e);
		} finally {
			deleting = false;
			quizToDelete = null;
		}
	}

	async function handleEditQuiz(quiz: PublishedFuiz) {
		if (openingQuizId) return;
		openingQuizId = quiz.id;
		try {
			const db = await loadDatabase();
			const creations = await getAllCreations(db);
			const existing = creations.find((c) => c.uniqueId === quiz.id);
			if (existing) {
				await goto(resolve(localizeHref(`/quiz/${existing.id}/edit`)));
				return;
			}

			// Fetch from server API
			const res = await fetch(resolve(`/api/quiz/${quiz.id}`));
			if (!res.ok) {
				alert(m.quiz_load_failed());
				return;
			}
			const json = await res.json();
			if (!json.config) {
				alert(m.quiz_content_missing());
				return;
			}

			const newId = await addCreation(
				{
					lastEdited: Date.now(),
					uniqueId: quiz.id,
					versionId: 0,
					config: json.config
				},
				db
			);

			await goto(resolve(localizeHref(`/quiz/${newId}/edit`)));
		} catch (e: any) {
			console.error('Failed to edit quiz:', e);
			alert(m.quiz_load_failed());
		} finally {
			openingQuizId = null;
		}
	}

	async function handleStartQuiz(quiz: PublishedFuiz) {
		if (startingQuizId) return;
		startingQuizId = quiz.id;
		try {
			const db = await loadDatabase();
			const creations = await getAllCreations(db);
			const existing = creations.find((c) => c.uniqueId === quiz.id);
			const saved = existing ? await getCreation(existing.id, db) : undefined;
			let config = saved?.config;

			if (!config) {
				const res = await fetch(resolve(`/api/quiz/${quiz.id}`));
				if (!res.ok) {
					alert(m.quiz_load_failed());
					return;
				}
				const json = await res.json();
				config = json.config;
				if (config) {
					await addCreation(
						{
							lastEdited: Date.now(),
							uniqueId: quiz.id,
							versionId: 0,
							config
						},
						db
					);
				}
			}

			if (!config) {
				alert(m.quiz_content_missing());
				return;
			}

			const defaultOptions = {
				random_names: null,
				show_answers: true,
				no_leaderboard: false,
				profanity: 'Censor' as const
			};

			const err = await playIdlessConfig(
				config,
				defaultOptions,
				{
					uniqueId: quiz.id,
					versionId: saved?.versionId ?? 0
				},
				db
			);

			if (err) {
				alert(err);
			}
		} catch (e: any) {
			console.error('Failed to start quiz:', e);
			alert(storageErrorMessage(e, m.quiz_start_failed()));
		} finally {
			startingQuizId = null;
		}
	}

	async function handleEndGame(gameCode: string) {
		try {
			if (!gameCode) return;
			await goto(resolve(localizeHref(`/host/${gameCode}?end=confirm`)));
		} catch (e) {
			console.error('Failed to end game:', e);
		}
	}
</script>

<svelte:head>
	<title>{title}</title>
	<meta property="og:title" content={title} />
	<meta name="description" content={description} />
	<meta property="og:description" content={description} />
	<link rel="canonical" href={env.PUBLIC_PLAY_URL + resolve(localizeHref('/'))} />
</svelte:head>

<ConfirmationDialog
	bind:this={confirmDeleteDialog}
	title={m.delete_forever()}
	message={m.delete_quiz_message()}
	confirmText={m.delete_confirm()}
	cancelText={m.cancel()}
	onConfirm={confirmDelete}
/>

<main>
	<MainHeader
		showLibrary={data.showLibrary}
		selfHosted={data.selfHosted}
		isAdmin={data.isAdmin}
		user={data.user}
	/>

	<section class="quick-start" aria-labelledby="join-heading">
		<div class="quick-start-inner">
			<div class="join-game">
				<h1 id="join-heading">{m.play()}</h1>
				<JoinForm inline />
			</div>
			{#if canCreate(data.user)}
				<div class="create-action">
					<FancyAnchorButton fill variant="secondary" href={resolve(localizeHref('/create'))}>
						<span class="create-label"><Add height="1.2em" aria-hidden="true" />{m.create()}</span>
					</FancyAnchorButton>
				</div>
			{/if}
		</div>
	</section>
	<!-- Live games section -->
	<section class="quizzes-section">
		<div class="quizzes-container">
			<div class="section-header">
				<div class="section-header-text">
					<h2 class="section-title">
						<svg height="1.2em" width="1.2em" viewBox="0 0 24 24" fill="currentColor">
							<path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12zm-6-2h2v-2h-2v2zm0-4h2V6h-2v4z"/>
						</svg>
						<span>{m.available_quizzes()}</span>
					</h2>
					<p class="section-subtitle">{m.available_quizzes_description()}</p>
				</div>

			</div>

			{#if activeQuizzes.length > 0 || standaloneRooms.length > 0}
				<div class="quizzes-grid">
					{#each activeQuizzes as quiz (quiz.id)}
						{@const isLive = !!activeGames[quiz.id]}
						{@const activeCode = activeGames[quiz.id]}
						{@const canManageLiveGame = canManageActiveGame(data.user, ownedGameCodes, activeCode)}
						<article class="quiz-card" class:is-live={isLive}>
							<div class="quiz-thumb">
								{#if isLive && !data.isAdmin}
									<a
										href={resolve(localizeHref(`/play?code=${activeCode}`))}
										class="quiz-thumb-link"
										title={m.play()}
									>
										{#if quiz.thumbnail}
											<img src={quiz.thumbnail} alt={quiz.thumbnail_alt || quiz.title} />
										{:else}
											<div class="thumb-fallback">
												<svg height="3em" width="3em" viewBox="0 0 24 24" fill="currentColor">
													<path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12zm-6-2h2v-2h-2v2zm0-4h2V6h-2v4z"/>
												</svg>
											</div>
										{/if}
										<div class="live-pill-badge">
											<span class="pulse-dot"></span>
											<span>{m.live()}</span>
										</div>
									</a>
								{:else}
									{#if quiz.thumbnail}
										<img src={quiz.thumbnail} alt={quiz.thumbnail_alt || quiz.title} />
									{:else}
										<div class="thumb-fallback">
											<svg height="3em" width="3em" viewBox="0 0 24 24" fill="currentColor">
												<path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12zm-6-2h2v-2h-2v2zm0-4h2V6h-2v4z"/>
											</svg>
										</div>
									{/if}
									{#if isLive}
										<div class="live-pill-badge">
											<span class="pulse-dot"></span>
											<span>{m.live()}</span>
										</div>
									{/if}
								{/if}
								<div class="slide-count-badge">
									{m.slides_count({ count: quiz.slides_count })}
								</div>
							</div>

							<div class="quiz-content">
								{#if isLive && !data.isAdmin}
									<a
										href={resolve(localizeHref(`/play?code=${activeCode}`))}
										class="quiz-title-link"
										title={m.play()}
									>
										<h3 class="quiz-title" title={quiz.title}>{quiz.title}</h3>
									</a>
								{:else}
									<h3 class="quiz-title" title={quiz.title}>{quiz.title}</h3>
								{/if}

								<div class="quiz-meta">
									<span class="quiz-author">{m.quiz_by({ author: quiz.author || m.admin() })}</span>
									{#if quiz.language}
										<span class="quiz-lang">{quiz.language.toUpperCase()}</span>
									{/if}
								</div>

								{#if isLive}
									<div class="live-info-banner">
										<span class="pulse-dot"></span>
										<span>{m.game_code_display({ code: activeCode })}</span>
									</div>
								{/if}

								<div class="quiz-card-actions">
									{#if data.isAdmin}
										<!-- Admin: Edit & Start buttons -->
										<FancyButton
											onclick={() => handleEditQuiz(quiz)}
											disabled={openingQuizId === quiz.id}
										>
											<div class="card-btn-inner">
												{#if openingQuizId === quiz.id}
													<span style="width: 1.1em; height: 1.1em"><LoadingCircle /></span>
												{:else}
													<Edit height="1.1em" />
												{/if}
												<span>{m.edit()}</span>
											</div>
										</FancyButton>

										{#if isLive && canManageLiveGame}
											<FancyAnchorButton
												href={resolve(localizeHref(`/host/${activeCode}`))}
											>
												<div class="card-btn-inner host-room-btn">
													<PlayArrow height="1.1em" />
													<span>{m.resume_host()}</span>
												</div>
											</FancyAnchorButton>

											<button
												type="button"
												class="admin-end-btn"
												aria-label={m.end()}
												title={m.end()}
												onclick={() => handleEndGame(activeCode)}
											>
												<StopCircle height="1.35em" width="1.35em" aria-hidden="true" />
												<span>{m.end()}</span>
											</button>
										{:else if !isLive}
											<FancyButton
												onclick={() => handleStartQuiz(quiz)}
												disabled={startingQuizId === quiz.id}
											>
												<div class="card-btn-inner start-btn">
													{#if startingQuizId === quiz.id}
														<span style="width: 1.1em; height: 1.1em"><LoadingCircle /></span>
													{:else}
														<PlayArrow height="1.2em" />
													{/if}
													<span>{m.start()}</span>
												</div>
											</FancyButton>
										{/if}

										<button
											type="button"
											class="admin-del-btn"
											title={m.delete_confirm()}
											disabled={deleting}
											onclick={() => askDeleteQuiz(quiz.id)}
										>
											<DeleteOutline height="1.1em" />
										</button>
									{:else}
										<!-- General User: Show Join ONLY if quiz has been started -->
										{#if data.user}
											<FancyButton
												onclick={() => handleEditQuiz(quiz)}
												disabled={openingQuizId === quiz.id}
											>{m.edit()}</FancyButton>
											{#if isLive && canManageLiveGame}
												<FancyAnchorButton
													href={resolve(localizeHref(`/host/${activeCode}`))}
												>
													<div class="card-btn-inner host-room-btn">
														<PlayArrow height="1.1em" />
														<span>{m.resume_host()}</span>
													</div>
												</FancyAnchorButton>
												<button
													type="button"
													class="admin-end-btn"
													aria-label={m.end()}
													title={m.end()}
													onclick={() => handleEndGame(activeCode)}
												><StopCircle height="1.35em" width="1.35em" aria-hidden="true" /><span
														>{m.end()}</span
													></button
												>
											{:else}
												<FancyButton
													onclick={() => handleStartQuiz(quiz)}
													disabled={startingQuizId === quiz.id}
												>{m.start()}</FancyButton>
											{/if}
										{/if}
										{#if isLive}
											<FancyAnchorButton
												href={resolve(localizeHref(`/play?code=${activeCode}`))}
											>
												<div class="card-btn-inner join-btn live-join-btn">
													<StadiaController height="1.2em" />
													<span>{m.join()}</span>
												</div>
											</FancyAnchorButton>
										{:else}
											<!-- Not started: NO Join button displayed -->
											<div class="not-started-tag">
												<svg height="1.1em" width="1.1em" viewBox="0 0 24 24" fill="currentColor">
													<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
												</svg>
												<span>{m.quiz_not_started()}</span>
											</div>
										{/if}
									{/if}
								</div>
							</div>
						</article>
					{/each}
					{#each standaloneRooms as room (room.game_code)}
						<article class="quiz-card live-room">
							<div class="quiz-content">
								<div class="live-room-heading">
									<h3 class="quiz-title">{m.live_game()}</h3>
									<span class="live-room-status"><span class="pulse-dot" aria-hidden="true"></span>{m.live()}</span>
								</div>
								<div class="live-room-code">
									<span>{m.game_code()}</span>
									<strong dir="ltr">{room.game_code}</strong>
								</div>
								<div class="live-room-actions">
									{#if canManageActiveGame(data.user, ownedGameCodes, room.game_code)}
										<FancyAnchorButton fill href={resolve(localizeHref(`/host/${room.game_code}`))}>
											<span class="live-room-action">
												<Slideshow height="1.15em" aria-hidden="true" />
												<span>{m.resume_host()}</span>
											</span>
										</FancyAnchorButton>
										<div class="live-room-secondary">
											<FancyAnchorButton fill variant="outline" href={resolve(localizeHref(`/play?code=${room.game_code}`))}>
												<span class="live-room-action">
													<StadiaController height="1.15em" aria-hidden="true" />
													<span>{m.join()}</span>
												</span>
											</FancyAnchorButton>
											<div class="live-room-end">
												<FancyButton
													fill
													variant="outline"
													type="button"
													onclick={() => handleEndGame(room.game_code)}
												>
													<span class="live-room-action">
														<StopCircle height="1.15em" width="1.15em" aria-hidden="true" />
														<span>{m.end()}</span>
													</span>
												</FancyButton>
											</div>
										</div>
									{:else}
										<FancyAnchorButton fill href={resolve(localizeHref(`/play?code=${room.game_code}`))}>
											<span class="live-room-action">
												<StadiaController height="1.15em" aria-hidden="true" />
												<span>{m.join()}</span>
											</span>
										</FancyAnchorButton>
									{/if}
								</div>
							</div>
						</article>
					{/each}
				</div>
			{:else}
				<div class="empty-state">
					<div class="empty-icon">
						<svg height="4em" width="4em" viewBox="0 0 24 24" fill="currentColor">
							<path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12zm-6-2h2v-2h-2v2zm0-4h2V6h-2v4z"/>
						</svg>
					</div>
					<h3>{m.no_live_games()}</h3>
				</div>
			{/if}
		</div>
	</section>

	<footer>
		{#if data.gamesPlayed !== undefined && data.playersJoined !== undefined}
			<dl class="usage-stats">
				<div><dt>{m.total_games()}</dt><dd>{data.gamesPlayed}</dd></div>
				<div><dt>{m.total_players()}</dt><dd>{data.playersJoined}</dd></div>
			</dl>
		{/if}
		<Footer />
	</footer>
</main>

<style>
	main {
		background-color: var(--surface);
		background-image: radial-gradient(
			ellipse 120% 40em at center 24em,
			color-mix(in srgb, var(--primary) 18%, var(--surface)) 0%,
			var(--surface) 80%
		);
		background-repeat: no-repeat;
		line-height: 1.25;
		min-height: 100vh;
	}

	main { display: flex; flex-direction: column; }
	footer { margin-top: auto; }

	.quick-start { padding: 1.5rem 1.5rem 2rem; }
	.quick-start-inner {
		max-width: 1100px;
		margin-inline: auto;
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1.5rem;
	}
	.join-game { width: min(100%, 32rem); }
	.join-game h1 {
		font: 700 1.5rem var(--alternative-font);
		margin: 0 0 1rem;
	}
	.create-action { flex-shrink: 0; }
	.create-label {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4em;
		min-height: 1.8em;
		font-family: var(--alternative-font);
	}
	.usage-stats {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 1rem;
		margin: 0;
		padding: 1rem;
		font-size: 0.8em;
		color: var(--on-surface-variant);
	}
	.usage-stats div { display: flex; gap: 0.4em; }
	.usage-stats dd { margin: 0; font-variant-numeric: tabular-nums; }
	@media (max-width: 700px) {
		.quick-start { padding: 1rem 1rem 1.5rem; }
		.quick-start-inner { align-items: stretch; flex-direction: column; gap: 0.75rem; }
		.join-game { width: 100%; }
	}
	/* Quizzes Section */
	.quizzes-section {
		padding: 0.5rem 1.5rem 2rem;
	}

	.quizzes-container {
		max-width: 1100px;
		margin: 0 auto;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		flex-wrap: wrap;
		gap: 1.2em;
		margin-bottom: 2em;
		border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
		padding-bottom: 1.2em;
	}

	.section-title {
		font-family: var(--alternative-font);
		font-size: 1.8em;
		display: flex;
		align-items: center;
		gap: 0.4em;
		margin: 0 0 0.2em;
		overflow-wrap: anywhere;
	}

	.section-subtitle {
		opacity: 0.75;
		margin: 0;
		font-size: 0.95em;
	}

	/* Quiz Card Grid */
	.quizzes-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
		gap: 1.5em;
	}

	.quiz-card {
		background: var(--surface, #1e1e2e);
		border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
		border-radius: 0.9em;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
		transition: transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
	}

	.quiz-card:hover {
		transform: translateY(-4px);
		box-shadow: 0 10px 24px rgba(0, 0, 0, 0.2);
		border-color: var(--primary, #3b82f6);
	}

	.quiz-thumb {
		position: relative;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		background: color-mix(in srgb, currentColor 8%, transparent);
	}

	.quiz-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.thumb-fallback {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--primary, #3b82f6);
		opacity: 0.8;
		background: radial-gradient(circle at center, color-mix(in srgb, var(--primary) 20%, transparent), transparent);
	}

	.slide-count-badge {
		position: absolute;
		bottom: 0.5em;
		right: 0.5em;
		background: rgba(0, 0, 0, 0.75);
		color: #fff;
		padding: 0.2em 0.6em;
		border-radius: 9999px;
		font-size: 0.8em;
		font-weight: 600;
		backdrop-filter: blur(4px);
	}

	.quiz-content {
		padding: 1.1em;
		display: flex;
		flex-direction: column;
		flex: 1;
	}

	.quiz-title {
		font-family: var(--alternative-font);
		font-size: 1.15em;
		margin: 0 0 0.3em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.quiz-meta {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.85em;
		opacity: 0.7;
		margin-bottom: 1.2em;
	}

	.quiz-lang {
		background: color-mix(in srgb, currentColor 10%, transparent);
		padding: 0.1em 0.4em;
		border-radius: 4px;
		font-size: 0.75em;
		font-weight: 600;
	}

	.quiz-card-actions {
		display: flex;
		align-items: center;
		gap: 0.4em;
		margin-top: auto;
	}

	.quiz-card-actions > :global(div) {
		flex: 1;
	}

	.card-btn-inner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35em;
		font-size: 0.88em;
		padding: 0.25em 0.4em;
		font-family: var(--alternative-font);
		white-space: nowrap;
	}

	.admin-del-btn {
		background: color-mix(in srgb, #ef4444 15%, transparent);
		color: #ef4444;
		border: 1px solid color-mix(in srgb, #ef4444 30%, transparent);
		border-radius: 0.5em;
		padding: 0.45em;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: background 150ms ease;
	}

	.admin-del-btn:hover {
		background: color-mix(in srgb, #ef4444 30%, transparent);
	}

	.admin-end-btn {
		min-height: 2.5rem;
		flex: 0 0 auto;
		background: color-mix(in srgb, var(--primary) 12%, var(--surface));
		color: var(--primary);
		border: 1px solid color-mix(in srgb, var(--primary) 45%, transparent);
		border-radius: 0.7em;
		padding: 0 0.7rem;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		font: 700 0.88em var(--alternative-font);
		cursor: pointer;
		transition: background 150ms ease, color 150ms ease, transform 150ms ease;
	}

	.admin-end-btn:hover {
		background: var(--primary);
		color: var(--on-primary);
		transform: translateY(-1px);
	}

	.admin-end-btn:active { transform: translateY(0); }

	.admin-end-btn:focus-visible {
		outline: 3px solid color-mix(in srgb, var(--primary) 45%, transparent);
		outline-offset: 3px;
	}

	/* Live state indicator */
	.is-live {
		border-color: #22c55e !important;
		box-shadow: 0 4px 20px rgba(34, 197, 94, 0.25) !important;
	}

	.live-pill-badge {
		position: absolute;
		top: 0.5em;
		left: 0.5em;
		background: #22c55e;
		color: #ffffff;
		padding: 0.2em 0.6em;
		border-radius: 9999px;
		font-size: 0.75em;
		font-weight: 700;
		letter-spacing: 0.05em;
		display: flex;
		align-items: center;
		gap: 0.35em;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
	}

	.pulse-dot {
		width: 7px;
		height: 7px;
		background-color: #ffffff;
		border-radius: 50%;
		display: inline-block;
		animation: live-pulse 1.4s infinite;
	}

	@keyframes live-pulse {
		0% {
			transform: scale(0.9);
			opacity: 1;
		}
		50% {
			transform: scale(1.3);
			opacity: 0.5;
		}
		100% {
			transform: scale(0.9);
			opacity: 1;
		}
	}

	.not-started-tag {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4em;
		font-size: 0.85em;
		opacity: 0.7;
		padding: 0.5em 0.8em;
		background: color-mix(in srgb, currentColor 5%, transparent);
		border-radius: 6px;
		border: 1px dashed color-mix(in srgb, currentColor 18%, transparent);
		user-select: none;
	}

	.quiz-thumb-link {
		display: block;
		width: 100%;
		height: 100%;
		text-decoration: none;
		color: inherit;
		cursor: pointer;
	}

	.quiz-title-link {
		color: inherit;
		text-decoration: none;
		display: block;
	}

	.quiz-title-link:hover .quiz-title {
		color: var(--primary, #3b82f6);
	}

	.live-join-btn {
		font-weight: 600;
	}


	.live-room {
		border-color: color-mix(in srgb, #22c55e 45%, var(--outline));
	}

	.live-room .quiz-content {
		gap: 1.15rem;
		padding: 1.25rem;
	}

	.live-room-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.live-room .quiz-title {
		min-width: 0;
		margin: 0;
		white-space: normal;
	}

	.live-room-status {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		flex: none;
		padding: 0.35rem 0.65rem;
		border: 1px solid color-mix(in srgb, #22c55e 35%, transparent);
		border-radius: 999px;
		background: color-mix(in srgb, #22c55e 10%, var(--surface));
		font-size: 0.8rem;
		font-weight: 700;
	}

	.live-room-status .pulse-dot {
		background: #16a34a;
		animation: none;
	}

	.live-room-code {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		padding-top: 0.85rem;
		border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
	}

	.live-room-code span {
		font-size: 0.85rem;
	}

	.live-room-code strong {
		font-family: var(--alternative-font);
		font-size: 1.65rem;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.04em;
		line-height: 1;
	}

	.live-room-actions {
		display: grid;
		gap: 0.55rem;
		margin-top: auto;
	}

	.live-room-secondary {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		align-items: center;
		gap: 0.6rem;
	}

	.live-room-action {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		min-height: 2.75rem;
		padding: 0.35rem 0.6rem;
		font-family: var(--alternative-font);
		font-size: 0.9rem;
		font-weight: 700;
		line-height: 1.2;
		text-align: center;
	}

	.live-room-action > span {
		text-box: trim-both cap alphabetic;
	}

	.live-room-end {
		--outline: color-mix(in srgb, var(--primary) 45%, transparent);
	}

	.live-room-end .live-room-action {
		color: color-mix(in srgb, var(--primary) 55%, var(--on-surface));
	}

	/* Empty state */
	.empty-state {
		text-align: center;
		padding: 2em 1em;
		background: color-mix(in srgb, currentColor 4%, transparent);
		border-radius: 1em;
		border: 1px dashed color-mix(in srgb, currentColor 15%, transparent);
	}

	.empty-icon {
		color: var(--primary, #3b82f6);
		opacity: 0.6;
		margin-bottom: 0.8em;
	}

	.empty-state h3 {
		font-family: var(--alternative-font);
		font-size: 1.4em;
		margin: 0 0 0.3em;
	}

</style>
