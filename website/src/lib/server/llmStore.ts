import {
	type LlmConfiguration,
	LlmError,
	type LlmList,
	type LlmSettings,
	validateLlmSettings
} from '../ai/llmConfiguration';
import type { Account } from './accounts';

export type LlmStatement = { sql: string; params: (string | number | null)[] };
type Row = Record<string, string | number | null>;
export type StoredLlm = {
	configuration: LlmConfiguration;
	settings: LlmSettings;
	encryptedKey: string | null;
};
const statement = (sql: string, ...params: LlmStatement['params']): LlmStatement => ({
	sql,
	params
});
const authority =
	"EXISTS (SELECT 1 FROM admins WHERE id=? AND session_version=? AND role='ADMIN' AND deleted_at IS NULL)";
function stored(row: Row): StoredLlm {
	const settings = validateLlmSettings(JSON.parse(String(row.settings)));
	return {
		settings,
		encryptedKey: row.encrypted_key === null ? null : String(row.encrypted_key),
		configuration: {
			...settings,
			id: String(row.id),
			version: Number(row.version),
			hasApiKey: row.encrypted_key !== null,
			createdAt: String(row.created_at),
			updatedAt: String(row.updated_at),
			createdBy: String(row.created_by),
			updatedBy: String(row.updated_by)
		}
	};
}
export abstract class LlmStore {
	protected abstract query(query: LlmStatement): Promise<Row[]>;
	protected abstract atomic(actor: Account, statements: LlmStatement[]): Promise<Row[][]>;
	async assertAdmin(actor: Account) {
		if (
			!actor ||
			!(
				await this.query(
					statement(
						`SELECT id FROM admins WHERE id=? AND ${authority}`,
						actor.id,
						actor.id,
						actor.sessionVersion
					)
				)
			).length
		)
			throw new LlmError('administrator_required', 403);
	}
	async list(actor: Account): Promise<LlmList> {
		await this.assertAdmin(actor);
		const state = await this.state();
		const configurations = (
			await this.query(
				statement(
					'SELECT * FROM llm_configurations WHERE deleted_at IS NULL ORDER BY created_at,id'
				)
			)
		).map((row) => stored(row).configuration);
		await this.assertAdmin(actor);
		return {
			configurations,
			selection: { activeId: state.active_id as string | null, version: Number(state.version) },
			established: Number(state.established) === 1
		};
	}
	private async state() {
		return (
			(await this.query(statement('SELECT * FROM llm_state WHERE id=1')))[0] ?? {
				active_id: null,
				version: 0,
				established: 0
			}
		);
	}
	async get(id: string): Promise<StoredLlm | undefined> {
		const [row] = await this.query(
			statement('SELECT * FROM llm_configurations WHERE id=? AND deleted_at IS NULL', id)
		);
		return row ? stored(row) : undefined;
	}
	async hasEncryptedCredentials(): Promise<boolean> {
		return (
			(
				await this.query(
					statement(
						'SELECT id FROM llm_configurations WHERE deleted_at IS NULL AND encrypted_key IS NOT NULL LIMIT 1'
					)
				)
			).length > 0
		);
	}
	async active(): Promise<StoredLlm | undefined> {
		// One SQL statement observes selection, values and ciphertext at the same database version.
		const [row] = await this.query(
			statement(
				'SELECT c.* FROM llm_configurations c JOIN llm_state s ON s.active_id=c.id WHERE s.id=1 AND c.deleted_at IS NULL'
			)
		);
		if (!row) return undefined;
		const result = stored(row);
		return result.settings.enabled ? result : undefined;
	}
	async audit(actor: Account, id: string) {
		await this.assertAdmin(actor);
		const rows = await this.query(
			statement(
				'SELECT id,configuration_id,configuration_version,actor_id,created_at,action,changed_fields,credential_action FROM llm_audit WHERE configuration_id=? ORDER BY created_at DESC,id LIMIT 100',
				id
			)
		);
		await this.assertAdmin(actor);
		return rows.map((row) => ({
			id: String(row.id),
			configurationId: String(row.configuration_id),
			configurationVersion: Number(row.configuration_version),
			actorId: String(row.actor_id),
			createdAt: String(row.created_at),
			action: String(row.action),
			changedFields: JSON.parse(String(row.changed_fields)) as string[],
			credentialAction: String(row.credential_action)
		}));
	}
	async save(
		actor: Account,
		id: string,
		expectedVersion: number | null,
		input: LlmSettings,
		encryptedKey: string | null,
		credentialAction: string,
		importing = false
	) {
		await this.assertAdmin(actor);
		const settings = validateLlmSettings(input);
		const previous = await this.get(id);
		if ((previous?.configuration.version ?? null) !== expectedVersion)
			throw new LlmError('configuration_conflict', 409);
		const state = await this.state();
		const mutation = crypto.randomUUID(),
			now = new Date().toISOString(),
			version = (expectedVersion ?? 0) + 1;
		const changed = (Object.keys(settings) as (keyof LlmSettings)[]).filter(
			(key) => !previous || settings[key] !== previous.settings[key]
		);
		const target =
			expectedVersion === null
				? 'NOT EXISTS (SELECT 1 FROM llm_configurations WHERE id=?)'
				: 'EXISTS (SELECT 1 FROM llm_configurations WHERE id=? AND version=? AND deleted_at IS NULL)';
		const claim = statement(
			`UPDATE llm_state SET version=version+1,established=1,mutation_id=? WHERE id=1 AND version=? AND ${authority} AND ${target}${importing ? ' AND established=0 AND NOT EXISTS (SELECT 1 FROM llm_configurations)' : ''} RETURNING version`,
			mutation,
			Number(state.version),
			actor.id,
			actor.sessionVersion,
			id,
			...(expectedVersion === null ? [] : [expectedVersion])
		);
		const write =
			expectedVersion === null
				? statement(
						'INSERT INTO llm_configurations(id,settings,encrypted_key,version,created_at,updated_at,created_by,updated_by) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM llm_state WHERE id=1 AND mutation_id=?)',
						id,
						JSON.stringify(settings),
						encryptedKey,
						version,
						now,
						now,
						actor.id,
						actor.id,
						mutation
					)
				: statement(
						'UPDATE llm_configurations SET settings=?,encrypted_key=?,version=?,updated_at=?,updated_by=? WHERE id=? AND EXISTS (SELECT 1 FROM llm_state WHERE id=1 AND mutation_id=?)',
						JSON.stringify(settings),
						encryptedKey,
						version,
						now,
						actor.id,
						id,
						mutation
					);
		await this.mutate(actor, claim, [
			write,
			this.auditWrite(
				mutation,
				id,
				version,
				actor.id,
				now,
				importing ? 'import' : previous ? 'update' : 'create',
				changed,
				credentialAction
			)
		]);
		return (await this.get(id))!.configuration;
	}
	async select(
		actor: Account,
		id: string | null,
		expectedConfigurationVersion: number | null,
		expectedSelectionVersion: number
	) {
		await this.assertAdmin(actor);
		const current = id ? await this.get(id) : undefined;
		if (
			id &&
			(!current?.settings.enabled || current.configuration.version !== expectedConfigurationVersion)
		)
			throw new LlmError('configuration_conflict', 409);
		const state = await this.state();
		const mutation = crypto.randomUUID(),
			now = new Date().toISOString();
		const claim = statement(
			`UPDATE llm_state SET version=version+1,active_id=?,mutation_id=? WHERE id=1 AND version=? AND ${authority}${id ? ' AND EXISTS (SELECT 1 FROM llm_configurations WHERE id=? AND version=? AND deleted_at IS NULL)' : ''} RETURNING version`,
			id,
			mutation,
			expectedSelectionVersion,
			actor.id,
			actor.sessionVersion,
			...(id ? [id, expectedConfigurationVersion!] : [])
		);
		const affectedId = id ?? state.active_id;
		const affected = current ?? (affectedId ? await this.get(String(affectedId)) : undefined);
		const writes = affected
			? [
					this.auditWrite(
						mutation,
						affected.configuration.id,
						affected.configuration.version,
						actor.id,
						now,
						id ? 'activate' : 'deactivate',
						['activeId'],
						'keep'
					)
				]
			: [];
		await this.mutate(actor, claim, writes);
	}
	async remove(
		actor: Account,
		id: string,
		expectedVersion: number,
		expectedSelectionVersion: number
	) {
		await this.assertAdmin(actor);
		const previous = await this.get(id);
		if (!previous || previous.configuration.version !== expectedVersion)
			throw new LlmError('configuration_conflict', 409);
		const state = await this.state();
		const mutation = crypto.randomUUID(),
			now = new Date().toISOString(),
			version = expectedVersion + 1;
		const claim = statement(
			`UPDATE llm_state SET version=version+1,active_id=CASE WHEN active_id=? THEN NULL ELSE active_id END,mutation_id=? WHERE id=1 AND version=? AND ${authority} AND EXISTS (SELECT 1 FROM llm_configurations WHERE id=? AND version=? AND deleted_at IS NULL) RETURNING version`,
			id,
			mutation,
			expectedSelectionVersion,
			actor.id,
			actor.sessionVersion,
			id,
			expectedVersion
		);
		await this.mutate(actor, claim, [
			statement(
				'UPDATE llm_configurations SET deleted_at=?,encrypted_key=NULL,version=?,updated_at=?,updated_by=? WHERE id=? AND EXISTS (SELECT 1 FROM llm_state WHERE id=1 AND mutation_id=?)',
				now,
				version,
				now,
				actor.id,
				id,
				mutation
			),
			this.auditWrite(
				mutation,
				id,
				version,
				actor.id,
				now,
				'delete',
				[
					'deletedAt',
					...(previous.encryptedKey !== null ? ['apiKey'] : []),
					...(state.active_id === id ? ['activeId'] : [])
				],
				'remove'
			)
		]);
	}
	private auditWrite(
		mutation: string,
		id: string,
		version: number,
		actor: string,
		now: string,
		action: string,
		changed: string[],
		credential: string
	) {
		return statement(
			'INSERT INTO llm_audit(id,configuration_id,configuration_version,actor_id,created_at,action,changed_fields,credential_action) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM llm_state WHERE id=1 AND mutation_id=?)',
			mutation,
			id,
			version,
			actor,
			now,
			action,
			JSON.stringify(changed),
			credential,
			mutation
		);
	}
	private async mutate(actor: Account, claim: LlmStatement, writes: LlmStatement[]) {
		// The state CAS serializes configuration and selection changes; a losing writer produces no audit entry.
		const results = await this.atomic(actor, [
			statement(
				'INSERT INTO llm_state(id,version,established) VALUES(1,0,0) ON CONFLICT(id) DO NOTHING'
			),
			claim,
			...writes
		]);
		if (!results[1].length) {
			await this.assertAdmin(actor);
			throw new LlmError('configuration_conflict', 409);
		}
	}
}
