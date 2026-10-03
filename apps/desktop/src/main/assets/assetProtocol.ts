/**
 * mirai-asset:// — the ONLY way imported images reach the renderer.
 *
 * Flow: `mirai-asset://<assetId>/` → main resolves the asset id through the
 * open project's StoryboardService → validates the path is INSIDE the
 * project root → streams the file via net.fetch. No renderer-side path
 * access, no directory traversal, works with plain <img src>.
 */
import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { isValidEntityId, type EntityId } from '@mirai/shared'
import type { StoryboardService } from '@mirai/core'

/** Must run BEFORE app ready (declares privileges for <img>/fetch use). */
export function declareAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'mirai-asset',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ])
}

/** Must run AFTER bootstrap (needs the DI container). */
export function registerAssetProtocol(resolveStoryboard: () => StoryboardService | null): void {
  protocol.handle('mirai-asset', async (request) => {
    try {
      const rawId = decodeURIComponent(request.url.replace('mirai-asset://', '')).split('/')[0] ?? ''
      if (!isValidEntityId(rawId)) {
        return new Response('Invalid asset id', { status: 400 })
      }
      const storyboard = resolveStoryboard()
      if (!storyboard) {
        return new Response('No project is open', { status: 404 })
      }
      const absolutePath = storyboard.assetAbsolutePath(rawId as EntityId)
      return await net.fetch(pathToFileURL(absolutePath).toString())
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Asset error'
      return new Response(message, { status: 404 })
    }
  })
}
