/**
 * Shared class recipes for the command palette groups/items.
 */
export const ItemStyles = {
  group:
    '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-mirai-faint [&_[cmdk-group-heading]]:uppercase',
  item: [
    'flex items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium text-mirai-dim',
    'transition-colors',
    'data-[selected=true]:bg-mirai-hover data-[selected=true]:text-mirai-text',
    '[&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-mirai-faint data-[selected=true]:[&_svg]:text-mirai-accent',
  ].join(' '),
}
