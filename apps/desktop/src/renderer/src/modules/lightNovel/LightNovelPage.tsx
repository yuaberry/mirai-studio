/**
 * Light Novel Pro (§9 slice 3) — volume/chapter structure + POV control.
 *
 * Layout: volumes (sidebar) → chapters (center) → chapter detail + POV (right).
 * Each chapter carries a POV setting — who tells this part of the story and
 * from which narrative perspective — so the author can plan voice
 * consistency across the whole light novel.
 */
import { useMemo, useState } from 'react'
import { Book, BookOpen, Plus, Trash2, Eye } from 'lucide-react'
import { type PovType, POV_TYPES } from '@mirai/shared'
import { Badge, Button, Input, Label, Select, Spinner } from '../../system/ui'
import { ErrorState } from '../../system/EmptyState'
import { ConfirmModal, Modal } from '../../system/Modal'
import {
  useVolumes,
  useVolumeMutations,
  useChapters,
  useChapterMutations,
} from '../../lib/queries'
import { invoke } from '../../lib/ipc'
import { toast } from '../../store/appStore'
import { T } from '../../system/T'

const POV_LABEL: Record<PovType, string> = {
  FIRST_PERSON: '1ª pessoa — "Eu"',
  THIRD_PERSON_LIMITED: '3ª limitada — câmera segue um personagem',
  THIRD_PERSON_OMNISCIENT: '3ª onisciente — narrador sabe tudo',
  SECOND_PERSON: '2ª pessoa — "Você"',
}

const POV_ICON: Record<PovType, string> = {
  FIRST_PERSON: '🎭',
  THIRD_PERSON_LIMITED: '🎬',
  THIRD_PERSON_OMNISCIENT: '👁️',
  SECOND_PERSON: '👤',
}

const STATUS_LABEL: Record<string, string> = {
  TODO: 'A fazer',
  IN_PROGRESS: 'Em andamento',
  REVIEW: 'Revisão',
  APPROVED: 'Aprovado',
  FINAL: 'Final',
}

export function LightNovelPage() {
  const volumesData = useVolumes()
  const volumeMutations = useVolumeMutations()
  const chapterMutations = useChapterMutations()

  const [selectedVolumeId, setSelectedVolumeId] = useState<string | null>(null)
  const [newVolumeOpen, setNewVolumeOpen] = useState(false)
  const [newChapterOpen, setNewChapterOpen] = useState(false)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [deleteVolumeId, setDeleteVolumeId] = useState<string | null>(null)
  const [deleteChapterId, setDeleteChapterId] = useState<string | null>(null)

  const volumes = useMemo(() => volumesData.data ?? [], [volumesData.data])
  const selectedVolume = useMemo(
    () => volumes.find((v) => v.id === selectedVolumeId) ?? null,
    [volumes, selectedVolumeId],
  )
  const chaptersData = useChapters(selectedVolumeId)
  const chapters = useMemo(() => chaptersData.data ?? [], [chaptersData.data])
  const selectedChapter = useMemo(
    () => chapters.find((c) => c.id === selectedChapterId) ?? null,
    [chapters, selectedChapterId],
  )

  // Auto-select first volume / chapter (runs after declarations above)
  if (volumes.length > 0 && !selectedVolumeId) {
    setSelectedVolumeId(volumes[0]!.id)
  }
  if (chapters.length > 0 && selectedVolume && !selectedChapterId) {
    setSelectedChapterId(chapters[0]!.id)
  }

  // POV control is at chapter level. Scenes link to chapters via Episodes & Scenes.

  // --------------------------------------------------- volume form

  const [newVolNumber, setNewVolNumber] = useState(1)
  const [newVolTitle, setNewVolTitle] = useState('')
  const [newVolStatus, setNewVolStatus] = useState('TODO')

  const handleCreateVolume = () => {
    if (!newVolTitle.trim()) return
    volumeMutations.create.mutate({
      number: newVolNumber,
      title: newVolTitle.trim(),
      status: newVolStatus as 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'APPROVED' | 'FINAL',
    })
    setNewVolNumber(volumes.length + 1)
    setNewVolTitle('')
    setNewVolStatus('TODO')
    setNewVolumeOpen(false)
  }

  // --------------------------------------------------- chapter form

  const [newChapNumber, setNewChapNumber] = useState(1)
  const [newChapTitle, setNewChapTitle] = useState('')
  const [newChapStatus, setNewChapStatus] = useState('TODO')
  const [newChapPovType, setNewChapPovType] = useState<PovType>('THIRD_PERSON_LIMITED')
  const [newChapPovCharId, setNewChapPovCharId] = useState<string | ''>('')

  const handleCreateChapter = () => {
    if (!selectedVolume) return
    if (!newChapTitle.trim()) return
    chapterMutations.create.mutate({
      volumeId: selectedVolume.id,
      number: newChapNumber,
      title: newChapTitle.trim(),
      synopsis: undefined,
      status: newChapStatus as 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'APPROVED' | 'FINAL',
      pov: newChapPovCharId
        ? { povType: newChapPovType, povCharacterId: newChapPovCharId }
        : { povType: newChapPovType, povCharacterId: undefined },
    })
    setNewChapNumber((chapters.length || 0) + 1)
    setNewChapTitle('')
    setNewChapStatus('TODO')
    setNewChapPovType('THIRD_PERSON_LIMITED')
    setNewChapPovCharId('')
    setNewChapterOpen(false)
  }

  // --------------------------------------------------- chapter POV form (editing existing)

  const [editPovType, setEditPovType] = useState<PovType>('THIRD_PERSON_LIMITED')
  const [editPovCharId, setEditPovCharId] = useState<string | ''>('')

  useState(() => {
    if (selectedChapter) {
      setEditPovType(selectedChapter.pov.povType)
      setEditPovCharId(selectedChapter.pov.povCharacterId ?? '')
    }
  })

  const handleUpdateChapterPov = () => {
    if (!selectedChapter) return
    chapterMutations.update.mutate({
      id: selectedChapter.id,
      pov: {
        povType: editPovType,
        povCharacterId: editPovCharId || undefined,
      },
    })
    toast({ kind: 'success', title: 'POV atualizado' })
  }

  // --------------------------------------------------- renders

  const isLoading = volumesData.isLoading || chaptersData.isLoading

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (volumesData.isError || chaptersData.isError) {
    return (
      <ErrorState
        title="Erro ao carregar"
        message={(volumesData.error ?? chaptersData.error!)?.message ?? 'Erro desconhecido'}
        onRetry={() => volumesData.refetch()}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0">
      {/* ------------------------------------------------- sidebar: volumes */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-mirai-border bg-murai-panel/50">
        <div className="flex items-center gap-2 px-4 py-4 border-b border-mirai-border">
          <Book className="h-5 w-5 text-mirai-accent" />
          <h1 className="font-display text-sm font-bold text-mirai-text"><T k="Light Novel" /></h1>
        </div>

        <div className="flex items-center gap-2 px-4 py-2">
          <Button
            size="sm"
            onClick={() => setNewVolumeOpen(true)}
            className="flex-1"
          >
            <Plus className="h-4 w-4" /> <span className="ml-1 text-xs">{'Novo volume'}</span>
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-2">
          {volumes.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-murai-text-soft">
              <T k="No volumes yet" />
            </div>
          ) : (
            <div className="space-y-1">
              {volumes.map((v) => {
                const active = v.id === selectedVolumeId
                return (
                  <button
                    key={v.id}
                    onClick={() => {
                      setSelectedVolumeId(v.id)
                      setSelectedChapterId(null)
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 rounded-lg text-left transition ${
                      active
                        ? 'bg-mirai-accent text-white'
                        : 'text-murai-text hover:bg-murai-hover'
                    }`}
                  >
                    <span className="w-6 text-center text-xs font-mono">{v.number}</span>
                    <span className="flex-1 truncate">{v.title}</span>
                    <Badge tone={v.status === 'FINAL' ? 'success' : v.status === 'TODO' ? 'neutral' : 'warn'}>
                      {STATUS_LABEL[v.status] ?? v.status}
                    </Badge>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteVolumeId(v.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 text-murai-text-soft hover:text-mirai-error transition"
                      title="Excluir volume"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {newVolumeOpen && (
          <Modal open={newVolumeOpen} onClose={() => setNewVolumeOpen(false)} title="Novo volume" width="max-w-sm">
            <div className="space-y-3">
              <Label><T k="Número" /></Label>
              <Input
                type="number"
                value={newVolNumber}
                onChange={(e) => setNewVolNumber(Math.max(1, parseInt(e.target.value, 10) || 1))}
                min="1"
              />
              <Label><T k="Título" /></Label>
              <Input value={newVolTitle} onChange={(e) => setNewVolTitle(e.target.value)} placeholder="Ex: Volume 1 — O Despertar" />
              <Label><T k="Status" /></Label>
              <Select value={newVolStatus} onChange={(e) => setNewVolStatus(e.target.value)}>
                {(['TODO', 'IN_PROGRESS', 'REVIEW', 'APPROVED', 'FINAL'] as const).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <Button variant="outline" size="sm" onClick={() => setNewVolumeOpen(false)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={handleCreateVolume}>Criar volume</Button>
            </div>
          </Modal>
        )}

        {deleteVolumeId !== null && (
          <ConfirmModal
            open={true}
            onClose={() => setDeleteVolumeId(null)}
            title="Excluir volume?"
            description="Os capítulos deste volume serão excluídos também."
            confirmLabel="Excluir"
            onConfirm={() => {
              const vid = deleteVolumeId
              if (vid) {
                volumeMutations.remove.mutate(vid)
                setSelectedVolumeId(null)
                setDeleteVolumeId(null)
              }
            }}
          />
        )}
      </aside>

      {/* ------------------------------------------------- center: chapters */}
      <div className="flex-1 flex flex-col border-r border-mirai-border bg-murai-panel/30 min-w-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-mirai-border">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-mirai-accent" />
            <span className="font-medium text-murai-text">
              {selectedVolume ? `Capítulos — ${selectedVolume.title}` : 'Capítulos'}
            </span>
          </div>
          <Button
            size="sm"
            disabled={!selectedVolume}
            onClick={() => setNewChapterOpen(true)}
            className="ml-2"
          >
            <Plus className="h-4 w-4" /> <span className="ml-1 text-xs">{'Novo capítulo'}</span>
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-2">
          {selectedVolume ? (
            chapters.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-murai-text-soft">
                <p>Nenhum capítulo ainda.</p>
                <p className="text-xs text-murai-text-soft/70 mt-1">Crie o primeiro capítulo deste volume.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {chapters.map((c) => {
                  const active = c.id === selectedChapterId
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        setSelectedChapterId(c.id)
                      }}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition ${
                        active
                          ? 'bg-mirai-accent/60 text-white border border-mirai-accent/30'
                          : 'text-murai-text hover:bg-murai-hover'
                      }`}
                    >
                      <span className="w-6 text-center text-xs font-mono">{c.number}</span>
                      <span className="flex-1 truncate">{c.title}</span>
                      <span className="w-10 text-right">
                        <span>{POV_ICON[c.pov.povType]}</span>
                      </span>
                      <Badge tone={c.status === 'FINAL' ? 'success' : c.status === 'TODO' ? 'neutral' : 'warn'} className="ml-2">
                        {STATUS_LABEL[c.status] ?? c.status}
                      </Badge>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteChapterId(c.id)
                        }}
                        className="opacity-0 group-hover:opacity-100 text-murai-text-soft hover:text-mirai-error transition"
                        title="Excluir capítulo"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </button>
                  )
                })}
              </div>
            )
          ) : (
            <div className="px-4 py-12 text-center text-sm text-murai-text-soft">
              <T k="Select a volume" />
            </div>
          )}
        </div>

        {newChapterOpen && (
          <Modal open={newChapterOpen} onClose={() => setNewChapterOpen(false)} title="Novo capítulo" width="max-w-md">
            <div className="space-y-3">
              <Label><T k="Número" /></Label>
              <Input
                type="number"
                value={newChapNumber}
                onChange={(e) => setNewChapNumber(Math.max(1, parseInt(e.target.value, 10) || 1))}
                min="1"
              />
              <Label><T k="Título" /></Label>
              <Input value={newChapTitle} onChange={(e) => setNewChapTitle(e.target.value)} placeholder="Ex: Capítulo 1 — A chegada" />
              <Label><T k="Status" /></Label>
              <Select value={newChapStatus} onChange={(e) => setNewChapStatus(e.target.value)}>
                {(['TODO', 'IN_PROGRESS', 'REVIEW', 'APPROVED', 'FINAL'] as const).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </Select>
              <div className="border-t border-mirai-border pt-3">
                <Label className="mb-2"><T k="POV do capítulo" /></Label>
                <Select value={newChapPovType} onChange={(e) => setNewChapPovType(e.target.value as PovType)}>
                  {(POV_TYPES as unknown as PovType[]).map((t) => (
                    <option key={t} value={t}>{POV_LABEL[t]}</option>
                  ))}
                </Select>
                {(newChapPovType === 'FIRST_PERSON' || newChapPovType === 'THIRD_PERSON_LIMITED') && (
                  <div className="mt-2">
                    <Label><T k="Personagem narrador (opcional)" /></Label>
                    <Input
                      value={newChapPovCharId}
                      onChange={(e) => setNewChapPovCharId(e.target.value)}
                      placeholder="ID ou nome do personagem"
                      className="text-xs"
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <Button variant="outline" size="sm" onClick={() => setNewChapterOpen(false)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={handleCreateChapter}>Criar capítulo</Button>
            </div>
          </Modal>
        )}

        {deleteChapterId !== null && (
          <ConfirmModal
            open={true}
            onClose={() => setDeleteChapterId(null)}
            title="Excluir capítulo?"
            description="Esta ação não pode ser desfeita."
            confirmLabel="Excluir"
            onConfirm={() => {
              const cid = deleteChapterId
              if (cid && selectedVolume) {
                chapterMutations.remove.mutate(cid)
                setSelectedChapterId(null)
                setDeleteChapterId(null)
              }
            }}
          />
        )}
      </div>

      {/* ------------------------------------------------- right: chapter detail + POV */}
      <div className="w-80 shrink-0 flex flex-col border-l border-mirai-border bg-murai-panel">
        <div className="px-4 py-3 border-b border-mirai-border">
          <h2 className="font-display text-sm font-bold text-mirai-text">{'POV & controle de cena'}</h2>
          <p className="text-xs text-murai-text-soft mt-1">
            Quem conta esta parte da história e de que perspectiva.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!selectedChapter ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Book className="h-12 w-12 opacity-20 mx-auto mb-3" />
              <p className="text-sm text-murai-text-soft">{'Selecione um capítulo'}</p>
              <p className="text-xs text-murai-text-soft/70 mt-1">Configure o ponto de vista deste capítulo.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label><T k="Título" /></Label>
                <p className="text-sm text-murai-text truncate">{selectedChapter.title}</p>
              </div>
              <div>
                <Label><T k="Número" /></Label>
                <p className="text-sm text-murai-text font-mono">{selectedChapter.number}</p>
              </div>
              <div>
                <Label><T k="Volume" /></Label>
                <p className="text-sm text-murai-text">
                  {selectedVolume ? selectedVolume.title : '—'}
                </p>
              </div>
              <div className="border-t border-mirai-border pt-3">
                <Label className="mb-2 block">{'POV atual'}</Label>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{POV_ICON[selectedChapter.pov.povType]}</span>
                  <span className="text-sm font-medium text-murai-text">{POV_LABEL[selectedChapter.pov.povType]}</span>
                  {selectedChapter.pov.povCharacterId && (
                    <span className="ml-2 px-2 py-0.5 rounded bg-murai-muted text-xs text-murai-text-soft border border-mirai-border">
                      Personagem: {selectedChapter.pov.povCharacterId}
                    </span>
                  )}
                </div>
              </div>
              <div className="border-t border-mirai-border pt-3">
                <Label className="mb-2 block">{'Alterar POV'}</Label>
                <Select value={editPovType} onChange={(e) => setEditPovType(e.target.value as PovType)}>
                  {(POV_TYPES as unknown as PovType[]).map((t) => (
                    <option key={t} value={t}>{POV_LABEL[t]}</option>
                  ))}
                </Select>
                {(editPovType === 'FIRST_PERSON' || editPovType === 'THIRD_PERSON_LIMITED') && (
                  <div className="mt-3">
                    <Label><T k="Personagem narrador" /></Label>
                    <Input
                      value={editPovCharId}
                      onChange={(e) => setEditPovCharId(e.target.value)}
                      placeholder="ID do personagem"
                      className="text-xs"
                    />
                  </div>
                )}
                <Button size="sm" onClick={handleUpdateChapterPov} className="mt-3 w-full">
                  Aplicar POV
                </Button>
              </div>
              {selectedChapter.synopsis && (
                <div className="border-t border-mirai-border pt-3">
                  <Label className="mb-2 block">{'Sinopse'}</Label>
                  <p className="text-sm text-murai-text-soft leading-relaxed">{selectedChapter.synopsis}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-mirai-border px-4 py-3">
          <Button
            size="sm"
            disabled={!selectedChapter}
            onClick={() => {
              if (!selectedChapter) return
              void invoke('ln:scenes:setPov', {
                id: selectedChapter.id,
                input: { povType: editPovType, povCharacterId: editPovCharId || undefined },
              })
            }}
            className="w-full"
          >
            <Eye className="h-4 w-4 mr-2" /> Aplicar POV à cena vinculada
          </Button>
        </div>
      </div>
    </div>
  )
}
