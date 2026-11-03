import { beforeNavigate, goto } from '$app/navigation';

/** Keep the mounted draft until its save is acknowledged; unload uses the native warning. */
export function guardUnsavedNavigation(
	isPending: () => boolean,
	isClosed: () => boolean,
	flush: () => Promise<boolean>
) {
	let leaving = false;
	beforeNavigate((navigation) => {
		if (isClosed() || !isPending()) return;
		navigation.cancel();
		if (leaving) return;
		leaving = true;
		void flush()
			.then(async (saved) => {
				if (!saved || isClosed() || navigation.willUnload || !navigation.to) return;
				if (navigation.type === 'popstate' && navigation.delta) history.go(navigation.delta);
				else await goto(navigation.to.url);
			})
			.finally(() => {
				leaving = false;
			});
	});
}
