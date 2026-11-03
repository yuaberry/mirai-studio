/**
 * OnboardingTour (V1 Beta Experimental 9) — guided welcome tour for new users.
 *
 * Shown once when `settings.session.onboardingCompleted` is false. Walks the
 * user through the core workflow: Project Hub → Story Bible → Characters →
 * Episodes & Scenes → Storyboard → AI Generation → Render & Export.
 *
 * Every step references a REAL module — nothing is mock data or a fake button.
 */
import { useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, X } from 'lucide-react'
import { Badge, Button } from './ui'
import { Modal } from './Modal'

interface OnboardingTourProps {
  open: boolean
  onClose: () => void
  onComplete: () => void
}

const STEPS = [
  {
    id: 'hub',
    title: 'Project Hub',
    description: 'Seus projetos vivem aqui. Crie um novo ou abra um existente — todos viajam com backups e duplicatas.',
    icon: '🏠',
    label: 'Hub de Projetos',
  },
  {
    id: 'bible',
    title: 'Story & Style Bible',
    description: 'Defina a premissa, temas, tom e direção de arte da sua obra. A IA lê isso para manter consistência.',
    icon: '📖',
    label: 'Bíblias',
  },
  {
    id: 'characters',
    title: 'Characters',
    description: 'Crie o elenco com personalidade, aparência, voz e relações. Cada personagem é um ativo reutilizável.',
    icon: '🎭',
    label: 'Personagens',
  },
  {
    id: 'episodes',
    title: 'Episodes & Scenes',
    description: 'Planeje episódios e escreva o roteiro de cada cena. O roteiro vira contexto para geração de imagem e voz.',
    icon: '📽️',
    label: 'Episódos e Cenas',
  },
  {
    id: 'storyboard',
    title: 'Storyboard',
    description: 'Divida cada cena em shots com framing, lente e movimento de câmera. Importe frames reais ou gere com IA.',
    icon: '🎬',
    label: 'Storyboard',
  },
  {
    id: 'render',
    title: 'Render & Export',
    description: 'Monte o timeline, adicione áudio e renderize um MP4 de verdade com FFmpeg — do roteiro ao episódio final.',
    icon: '🎞️',
    label: 'Render e Exportar',
  },
]

export function OnboardingTour({ open, onClose, onComplete }: OnboardingTourProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const step = STEPS[stepIndex]
  const isLast = stepIndex === STEPS.length - 1

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title="Bem-vindo ao Mirai Studio" width="max-w-2xl">
      <div className="flex flex-col h-full min-h-0">
        {/* Progress indicator */}
        <div className="mb-4 flex items-center gap-1">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 w-4 rounded-full transition-colors ${
                i < stepIndex
                  ? 'bg-mirai-accent'
                  : i === stepIndex
                  ? 'bg-mirai-border-strong'
                  : 'bg-murai-panel/40'
              }`}
            />
          ))}
          <span className="ml-2 text-[10px] text-mirai-faint">
            {stepIndex + 1} de {STEPS.length}
          </span>
        </div>

        {/* Step content */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="text-6xl mb-4">{step!.icon}</div>
          <h2 className="font-display text-xl font-bold text-mirai-text mb-2">{step!.title}</h2>
          <p className="text-sm text-murai-text-soft leading-relaxed max-w-md mx-auto">
            {step!.description}
          </p>
        </div>

        {/* Footer navigation */}
        <div className="border-t border-mirai-border px-6 py-4 flex items-center justify-between bg-murai-panel/30">
          <div className="flex items-center gap-2">
            <Badge tone={stepIndex === 0 ? 'neutral' : 'info'}>
              {step!.label}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <Button size="sm" variant="outline" onClick={() => setStepIndex((i) => i - 1)}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Voltar
              </Button>
            )}
            {isLast ? (
              <Button size="sm" variant="primary" onClick={onComplete}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Concluir tour
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => setStepIndex((i) => i + 1)}>
                Próximo <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="h-3.5 w-3.5" /> Pular
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
