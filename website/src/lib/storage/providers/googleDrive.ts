import { resolve } from '$app/paths';
import type { Base64Media } from '../../types';
import type {
	InternalFuiz,
	InternalFuizMetadata,
	InternalReport,
	LocalDatabase,
	MediaReferencedFuizConfig,
	ReportBody
} from '..';
import { type AccountBinding, accountRequest } from '../account';
import { referencedLegacyMedia } from '../legacy';
export class GoogleDriveSync {
	static readonly name = 'google-drive';
	static readonly displayName = 'Google Drive';
	readonly name = GoogleDriveSync.name;
	readonly displayName = GoogleDriveSync.displayName;
	constructor(private readonly binding: AccountBinding) {}
	static async status(): Promise<{ authenticated: boolean; available: boolean }> {
		try {
			const response = await fetch(resolve('/api/gdrive/status'), { cache: 'no-store' });
			return response.ok ? await response.json() : { authenticated: false, available: false };
		} catch {
			return { authenticated: false, available: false };
		}
	}
	static login(returnUrl?: string): void {
		window.location.href = resolve(
			`/api/gdrive/login?return=${encodeURIComponent(returnUrl ?? window.location.pathname)}`
		);
	}
	async logout(): Promise<void> {
		await accountRequest(this.binding, '/api/gdrive/logout', { method: 'POST' });
		window.location.reload();
	}
	// Only authoritative current resources are pushed. Remote-only/legacy files never populate a cache.
	async sync(_local: LocalDatabase, _existing: [number, InternalFuizMetadata][]): Promise<void> {
		const { resources }: { resources: { record: InternalFuiz }[] } = await (
			await accountRequest(this.binding, '/api/creations')
		).json();
		for (const { record } of resources) {
			for (const hash of referencedLegacyMedia(record)) {
				const media = await (
					await accountRequest(this.binding, `/api/host/media/${encodeURIComponent(hash)}`)
				).json();
				await this.createImage(hash, media);
			}
			await this.create(record.uniqueId, record);
		}
	}
	async syncReports(
		_local: LocalDatabase,
		_existing: [number, InternalFuizMetadata][]
	): Promise<void> {
		const { resources }: { resources: { record: InternalReport }[] } = await (
			await accountRequest(this.binding, '/api/reports')
		).json();
		for (const { record } of resources) await this.createReport(record.uniqueId, record);
	}
	async get(uuid: string): Promise<MediaReferencedFuizConfig> {
		return (
			(await (
				await accountRequest(this.binding, `/api/gdrive/fuiz/${encodeURIComponent(uuid)}`)
			).json()) as InternalFuiz
		).config;
	}
	async getReport(uuid: string): Promise<ReportBody> {
		return (
			await accountRequest(this.binding, `/api/gdrive/reports/${encodeURIComponent(uuid)}`)
		).json();
	}
	async getImage(hash: string): Promise<Base64Media> {
		return (
			await accountRequest(this.binding, `/api/gdrive/images/${encodeURIComponent(hash)}`)
		).json();
	}
	async create(uuid: string, value: InternalFuiz): Promise<void> {
		await accountRequest(this.binding, `/api/gdrive/fuiz/${encodeURIComponent(uuid)}`, {
			method: 'POST',
			body: JSON.stringify(value)
		});
	}
	update(uuid: string, value: InternalFuiz) {
		return this.create(uuid, value);
	}
	async delete(uuid: string): Promise<void> {
		await accountRequest(this.binding, `/api/gdrive/fuiz/${encodeURIComponent(uuid)}`, {
			method: 'DELETE'
		});
	}
	async createReport(uuid: string, value: InternalReport): Promise<void> {
		await accountRequest(this.binding, `/api/gdrive/reports/${encodeURIComponent(uuid)}`, {
			method: 'POST',
			body: JSON.stringify(value)
		});
	}
	updateReport(uuid: string, value: InternalReport) {
		return this.createReport(uuid, value);
	}
	async deleteReport(uuid: string): Promise<void> {
		await accountRequest(this.binding, `/api/gdrive/reports/${encodeURIComponent(uuid)}`, {
			method: 'DELETE'
		});
	}
	async createImage(hash: string, value: Base64Media): Promise<void> {
		await accountRequest(this.binding, `/api/gdrive/images/${encodeURIComponent(hash)}`, {
			method: 'POST',
			body: JSON.stringify(value)
		});
	}
}
