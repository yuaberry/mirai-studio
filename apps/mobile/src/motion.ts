/**
 * Motion no celular — a MESMA regra do desktop: tudo lê var(--motion-ms),
 * com o kill switch. O companion não tem painel de settings ainda, então o
 * padrão é ligado e respeita a preferência do sistema.
 */
export const motionCss = `
:root { --motion-ms: 220ms; --motion-ease: cubic-bezier(0.4,0,0.2,1); }
.motion-lift { transition: transform var(--motion-ms) var(--motion-ease), box-shadow var(--motion-ms) var(--motion-ease), border-color var(--motion-ms) var(--motion-ease); }
.motion-lift:active { transform: scale(0.985); }
.motion-stagger > * { animation: mirai-rise-in var(--motion-ms) var(--motion-ease) both; }
@keyframes mirai-rise-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
button { transition: transform var(--motion-ms) var(--motion-ease), background-color var(--motion-ms) var(--motion-ease), border-color var(--motion-ms) var(--motion-ease); }
button:active { transform: scale(0.97); }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; } }
`
