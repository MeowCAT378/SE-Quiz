<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ConfirmationDialog from '$lib/feedback/ConfirmationDialog.svelte';
	import ErrorMessage from '$lib/feedback/ErrorMessage.svelte';
	import Modal from '$lib/feedback/Modal.svelte';
	import TypicalPage from '$lib/layout/TypicalPage.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';
	import type { AccountRole, PublicAccount } from '$lib/server/accounts';
	import FancyAnchorButton from '$lib/ui/FancyAnchorButton.svelte';
	import FancyButton from '$lib/ui/FancyButton.svelte';
	import OptionsField from '$lib/ui/OptionsField.svelte';
	import Textfield from '$lib/ui/Textfield.svelte';

	let { data } = $props();
	let editor = $state<Modal>();
	let confirmation = $state<ConfirmationDialog>();
	let editing = $state<PublicAccount | null>(null);
	let email = $state('');
	let password = $state('');
	let role = $state<AccountRole | undefined>('TEACHER');
	let busy = $state(false);
	let error = $state('');
	let deleting = $state<PublicAccount | null>(null);
	const roles: AccountRole[] = ['TEACHER', 'ADMIN'];
	const normalizedEmail = () => email.trim().toLowerCase();
	function open(account: PublicAccount | null) {
		editing = account;
		email = account?.email ?? '';
		password = '';
		role = account?.role ?? 'TEACHER';
		error = '';
		deleting = null;
		editor?.open();
	}
	async function mutate(remove = false) {
		if (busy) return;
		busy = true;
		error = '';
		const target = remove ? deleting : editing;
		try {
			const response = await fetch(resolve(`/api/admin/users${target ? `/${target.id}` : ''}`), {
				method: remove ? 'DELETE' : target ? 'PATCH' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: remove ? undefined : JSON.stringify({ email, password, role })
			});
			if (!response.ok) {
				if (response.status === 401 || response.status === 403) {
					await goto(resolve(localizeHref('/login')));
					return;
				}
				const emailChanged = !target || normalizedEmail() !== target.email;
				throw new Error(
					response.status === 409
						? emailChanged
							? m.email_conflict()
							: m.user_conflict()
						: m.user_management_error()
				);
			}
			editor?.close();
			if (target?.id === data.currentUserId) {
				await goto(resolve(localizeHref('/login')), { invalidateAll: true });
				return;
			}
			await invalidateAll();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.user_management_error();
		} finally {
			busy = false;
			password = '';
		}
	}
	function save() {
		if (password && [...password].length < 12) {
			error = m.password_too_short();
			return;
		}
		if (new TextEncoder().encode(password).length > 1024) {
			error = m.password_too_long();
			return;
		}
		if ((editing && role !== editing.role) || (!editing && role === 'ADMIN')) confirmation?.open();
		else void mutate();
	}
</script>

<svelte:head><title>{m.user_management()}</title></svelte:head>
<TypicalPage>
  <main>
    <header class="page-header">
      <h1>{m.user_management()}</h1>
      <div class="actions page-actions">
        <FancyAnchorButton variant="ghost" href={resolve(localizeHref("/"))}
          >{m.back_home()}</FancyAnchorButton
        >
        <FancyAnchorButton
          variant="secondary"
          href={resolve(localizeHref("/admin/import"))}
          >{m.legacy_import()}</FancyAnchorButton
        >
        <FancyButton onclick={() => open(null)} disabled={busy}
          >{m.new_user()}</FancyButton
        >
      </div>
    </header>
    <div class="table-card">
      {#if error}<ErrorMessage errorMessage={error} />{/if}
      <div class="table-wrap">
        <table>
          <caption>{m.user_management()}</caption>
          <thead
            ><tr
              ><th scope="col">{m.email()}</th><th scope="col">{m.account_role()}</th><th scope="col"
                >{m.account_status()}</th
              ><th scope="col">{m.account_created()}</th><th scope="col">{m.account_actions()}</th></tr
            ></thead
          >
          <tbody>
            {#if data.users.length === 0}
              <tr><td class="empty" colspan="5">{m.no_users()}</td></tr>
            {:else}
              {#each data.users as account (account.id)}<tr>
                <td>{account.email}</td><td
                  >{account.role === "ADMIN" ? m.admin() : m.teacher_role()}</td
                >
                <td
                  ><span class:disabled={!!account.deletedAt} class="status"
                    >{account.deletedAt
                      ? m.account_deleted()
                      : m.account_active()}</span
                ></td
                ><td>{new Date(account.createdAt).toLocaleString(getLocale())}</td>
                <td
                  >{#if !account.deletedAt}<div class="actions row-actions">
                      <FancyButton
                        variant="secondary"
                        disabled={busy}
                        onclick={() => open(account)}>{m.edit()}</FancyButton
                      >
                      <FancyButton
                        variant="danger"
                        disabled={busy}
                        onclick={() => {
                          deleting = account;
                          confirmation?.open();
                        }}>{m.delete_confirm()}</FancyButton
                      >
                    </div>{/if}</td
                >
              </tr>{/each}
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  </main>
</TypicalPage>
<Modal
  bind:this={editor}
  width="min(32rem, calc(100vw - 2em))"
  ariaLabelledby="user-editor-title"
  ariaDescribedby="password-help"
>
  <h2 id="user-editor-title">{editing ? m.edit_user() : m.new_user()}</h2>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      save();
    }}
  >
    <Textfield
      id="email"
      label={m.email()}
      placeholder=""
      type="email"
      required
      disabled={busy}
      maxLength={254}
      invalidMessage={m.email_required()}
      autocomplete="username"
      bind:value={email}
    />
    <Textfield
      id="password"
      label={editing ? m.replacement_password() : m.password()}
      placeholder={editing ? m.optional() : ""}
      type="password"
      required={!editing}
      disabled={busy}
      minLength={12}
      invalidMessage={m.password_too_short()}
      ariaDescribedby="password-help"
      autocomplete="new-password"
      bind:value={password}
    />
    <p id="password-help" class="helper">
      {editing ? m.password_policy() : m.password_too_short()}
    </p>
    <OptionsField
      id="account-role"
      label={m.account_role()}
      options={roles}
      bind:selected={role}
      map={(value) => (value === "ADMIN" ? m.admin() : m.teacher_role())}
      disabled={busy}
    />
    {#if error}<ErrorMessage errorMessage={error} />{/if}
    <div class="actions modal-actions">
      <FancyButton
        variant="secondary"
        type="button"
        onclick={() => editor?.close()}
        disabled={busy}>{m.cancel()}</FancyButton
      ><FancyButton type="submit" disabled={busy}
        >{editing ? m.save_changes() : m.save_user()}</FancyButton
      >
    </div>
  </form>
</Modal>
<ConfirmationDialog
  bind:this={confirmation}
  title={deleting ? m.delete_confirm() : m.confirm_role_change()}
  message={m.account_change_warning()}
  confirmText={deleting ? m.delete_confirm() : m.save_user()}
  onConfirm={() => void mutate(!!deleting)}
/>

<style>
  main {
    max-width: 1280px;
    margin: auto;
    padding: 2em 1.5em;
    box-sizing: border-box;
    min-width: 0;
  }
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5em;
    margin-bottom: 1.5em;
  }
  h1 {
    font-family: var(--alternative-font);
    font-size: clamp(1.75rem, 3vw, 2.5rem);
    margin: 0;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.5em;
    flex-wrap: wrap;
  }
  .page-actions {
    justify-content: flex-end;
  }
  .table-card {
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--outline);
    border-radius: 0.75em;
    background: color-mix(in srgb, var(--surface) 94%, var(--on-surface));
  }
  .table-wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    min-width: 48rem;
    border-collapse: collapse;
  }
  caption {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  th,
  td {
    text-align: start;
    padding: 0.9em 1em;
    border-bottom: 1px solid var(--outline);
    vertical-align: middle;
  }
  th {
    font-size: 0.78em;
    font-weight: 700;
    color: var(--on-surface-variant);
    background: color-mix(in srgb, var(--on-surface) 5%, var(--surface));
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
  .row-actions {
    flex-wrap: nowrap;
  }
  .empty {
    color: var(--on-surface-variant);
    text-align: center;
    padding-block: 2em;
  }
  .status {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 0.2em 0.65em;
    color: #075b37;
    background: #d6f5e7;
    font-size: 0.8em;
    font-weight: 600;
    white-space: nowrap;
  }
  .status.disabled {
    color: var(--on-surface-variant);
    background: var(--surface-variant);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 1em;
  }
  p {
    margin: 0;
  }
  h2 {
    margin: 0 0 1em;
    font-family: var(--alternative-font);
  }
  .helper {
    color: var(--on-surface-variant);
    font-size: 0.9em;
    line-height: 1.5;
  }
  .modal-actions {
    justify-content: flex-end;
    padding-top: 0.25em;
  }
  @media (max-width: 700px) {
    main {
      padding: 1.25em 0.75em;
    }
    .page-header {
      align-items: flex-start;
      flex-direction: column;
    }
    .page-actions {
      justify-content: flex-start;
    }
  }
  @media (max-width: 380px) {
    .modal-actions {
      align-items: stretch;
      flex-direction: column-reverse;
    }
    .modal-actions :global(button) {
      width: 100%;
    }
  }
</style>
