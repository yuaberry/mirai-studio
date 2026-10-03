/**
 * ContentCard (Settings) — Pro licensing + Mature Content Mode with the
 * story-first conscientization: the app's identity is storytelling; mature
 * mode unlocks R-18 tools, never redefines the studio.
 */
import { useState } from 'react'
import { Badge, Button, Input, SectionTitle } from '../../system/ui'
import { useLicenseMutations, useLicenseStatus, useSetMature, useSettings } from '../../lib/queries'
import { toast } from '../../store/appStore'
import { Modal } from '../../system/Modal'
import { FEATURE_LABEL, type LicenseFeature } from '@mirai/shared'

export function ContentCard() {
  const { data: settings } = useSettings()
  const { data: status } = useLicenseStatus()
  const activate = useLicenseMutations()
  const setMature = useSetMature()
  const [key, setKey] = useState('')
  const [matureNotice, setMatureNotice] = useState(false)
  const [ageOk, setAgeOk] = useState(false)
  const [policyOk, setPolicyOk] = useState(false)
  const [treadSoftly, setTreadSoftly] = useState(false)

  const content = settings?.content
  const matureEnabled = content?.matureEnabled ?? false
  const licenseActive = status?.valid ?? false

  return (
    <>
      <div className="p-5">
        <SectionTitle right={<span className="text-[10px] text-mirai-faint">Offline Ed25519-signed keys — no server, no telemetry</span>}>
          Content & Pro license
        </SectionTitle>

        <div className="space-y-3">
          {/* license */}
          <div className="rounded-md border border-mirai-line bg-mirai-panel p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-mirai-text">
                  Mirai Studio Pro
                  {licenseActive && <Badge tone="accent">active</Badge>}
                </p>
                <p className="mt-0.5 text-[11px] text-mirai-faint">
                  {licenseActive && status?.payload
                    ? `${status.payload.holder} · ${status.payload.tier} · ${
                        status.payload.exp !== null
                          ? `expires ${new Date(status.payload.exp * 1000).toLocaleDateString()}`
                          : 'lifetime'
                      } · ${status.payload.features.map((f) => FEATURE_LABEL[f as LicenseFeature]).join(', ')}`
                    : 'The core studio is free forever. Pro unlocks Mature Content Mode.'}
                </p>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <Input
                className="h-8 flex-1 font-mono text-xs"
                placeholder="Paste your Pro license key…"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <Button
                size="sm"
                variant="primary"
                disabled={key.trim().length < 10}
                loading={activate.activate.isPending}
                onClick={() =>
                  activate.activate.mutate(key.trim(), {
                    onSuccess: (s) => {
                      if (s.valid) toast({ kind: 'success', title: 'Pro license activated' })
                      else toast({ kind: 'error', title: 'License invalid', description: s.reason ?? undefined })
                      setKey('')
                    },
                    onError: (err) => toast({ kind: 'error', title: 'Activation failed', description: err.message }),
                  })
                }
              >
                Activate
              </Button>
            </div>
          </div>

          {/* mature toggle */}
          <div className="rounded-md border border-mirai-line bg-mirai-panel p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-mirai-text">
                  Mature Content Mode
                  {matureEnabled && <Badge tone="accent">18+ tools unlocked</Badge>}
                </p>
                <p className="mt-0.5 max-w-lg text-[11px] leading-relaxed text-mirai-faint">
                  Unlocks R-18 storytelling: mature genres (Hentai, Erotica, Adult Drama), mature-rated
                  projects and explicit artistic direction in generation prompts. The studio stays
                  story-first — this is a toolset for adult <em>narratives</em>, not an adult-content mill.
                </p>
              </div>
              <Button
                size="sm"
                variant={matureEnabled ? 'outline' : 'primary'}
                disabled={!matureEnabled && !licenseActive}
                title={!licenseActive ? 'Requires an active Pro license with the mature feature' : undefined}
                onClick={() => {
                  if (matureEnabled) {
                    setMature.mutate(
                      { enabled: false, ageConfirmed: true },
                      {
                        onSuccess: () => toast({ kind: 'success', title: 'Mature Content Mode disabled' }),
                      },
                    )
                  } else {
                    setAgeOk(false)
                    setPolicyOk(false)
                    setTreadSoftly(false)
                    setMatureNotice(true)
                  }
                }}
              >
                {matureEnabled ? 'Disable' : 'Enable…'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* conscientization */}
      <Modal
        open={matureNotice}
        onClose={() => setMatureNotice(false)}
        title="Before you enable Mature Content Mode"
        width="max-w-lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMatureNotice(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!ageOk || !policyOk || !treadSoftly}
              loading={setMature.isPending}
              onClick={() => {
                setMature.mutate(
                  { enabled: true, ageConfirmed: true },
                  {
                    onSuccess: () => {
                      toast({
                        kind: 'success',
                        title: 'Mature Content Mode enabled',
                        description: 'Rate your project 18+ in its config to activate mature prompts.',
                      })
                    },
                    onError: (err) => toast({ kind: 'error', title: 'Enable failed', description: err.message }),
                  },
                )
                setMatureNotice(false)
              }}
            >
              I understand — enable
            </Button>
          </>
        }
      >
        <div className="max-h-96 space-y-3 overflow-y-auto pr-1 text-[11px] leading-relaxed text-mirai-dim">
          <p className="font-display text-sm font-bold text-mirai-text">This is a storytelling studio.</p>
          <p>
            Mirai Studio exists to turn anime ideas into real productions — worlds, characters,
            episodes, rendered video. Mature Content Mode extends that to adult-rated{' '}
            <strong>stories</strong>: dramatic, sensual, or explicit scenes written by you, for
            narratives where they mean something. It does not turn this into an adult-content
            generator, and it never will.
          </p>
          <div className="rounded-md border border-mirai-line bg-mirai-bg p-2">
            <p className="font-bold text-mirai-text">The hard rules — enforced in code:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>
                <strong>Adults only.</strong> Explicit generation requires every cast character to
                have an explicitly adult age. Minors and unstated ages are blocked — no exceptions.
              </li>
              <li>
                <strong>You own what you make.</strong> You are responsible for the legality of your
                content in your jurisdiction and for complying with the terms of the AI providers you
                configure — some providers forbid NSFW outputs; check yours.
              </li>
              <li>
                <strong>Fiction, clearly.</strong> Everything produced here is fictional creative work.
              </li>
            </ul>
          </div>
          <label className="flex items-start gap-2 text-mirai-text">
            <input type="checkbox" className="mt-0.5" checked={ageOk} onChange={(e) => setAgeOk(e.target.checked)} />
            I confirm I am 18 years or older and mature content is legal for me to produce and possess.
          </label>
          <label className="flex items-start gap-2 text-mirai-text">
            <input type="checkbox" className="mt-0.5" checked={policyOk} onChange={(e) => setPolicyOk(e.target.checked)} />
            I understand the hard rules above and that they are enforced automatically by the app.
          </label>
          <label className="flex items-start gap-2 text-mirai-text">
            <input type="checkbox" className="mt-0.5" checked={treadSoftly} onChange={(e) => setTreadSoftly(e.target.checked)} />
            I will use these tools to tell stories — mature content serves my narrative, it is not the product.
          </label>
        </div>
      </Modal>
    </>
  )
}
