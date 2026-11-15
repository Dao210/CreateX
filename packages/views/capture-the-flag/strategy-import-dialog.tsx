import { useRef, useState } from "react";
import { FileUp, Check, Copy } from "lucide-react";
import {
  CTF_FILE_LIMIT,
  GAME_VERSION,
  parseCTFImport,
  type CTFImportResult,
  type SaveStrategyInput,
  type StrategyRecord,
  type StrategySummary as Summary,
} from "@auro/core/capture-the-flag";
import { Button } from "@auro/ui/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@auro/ui/components/ui/dialog";
import { useT } from "../i18n";
import { StrategySummary } from "./strategy-summary";

type Selection = {
  filename: string;
  name: string;
  result: CTFImportResult;
  requestId: string;
};
export function StrategyImportDialog({
  target,
  disabled,
  onSave,
  onSaved,
}: {
  target?: Summary;
  disabled?: boolean;
  onSave: (input: SaveStrategyInput) => Promise<StrategyRecord>;
  onSaved: (record: StrategyRecord) => void;
}) {
  const { t } = useT("ctf");
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const targetVersion = useRef<{ id: string; revision: number } | null>(null);
  const pending = reading || saving;
  const valid = selection?.result.ok ? selection.result.strategy : null;
  const issue = selection && !selection.result.ok ? selection.result : null;

  const choose = async (file: File) => {
    const current = ++generation.current;
    setReading(true);
    setError("");
    setCopied(false);
    setSelection(null);
    try {
      const result: CTFImportResult =
        file.size > CTF_FILE_LIMIT
          ? { ok: false, reason: "tooLarge", details: [] }
          : parseCTFImport(await file.text());
      if (current !== generation.current) return;
      setSelection({
        filename: file.name,
        name:
          file.name
            .replace(/\.(strategy|json)$/i, "")
            .trim()
            .slice(0, 128) ||
          (result.ok ? result.strategy.team.team_name : file.name),
        result,
        requestId: crypto.randomUUID(),
      });
    } catch {
      if (current === generation.current) setError(t(($) => $.files.readError));
    } finally {
      if (current === generation.current) setReading(false);
    }
  };
  const save = async () => {
    if (!selection?.result.ok || saving) return;
    setSaving(true);
    setError("");
    try {
      const record = await onSave({
        requestId: selection.requestId,
        ...(targetVersion.current ? { id: targetVersion.current.id } : {}),
        expectedRevision: targetVersion.current?.revision ?? 0,
        name: selection.name,
        strategy: selection.result.strategy,
      });
      onSaved(record);
      setOpen(false);
    } catch (e) {
      setError(
        e instanceof Error && e.message === "revision_conflict"
          ? t(($) => $.conflict)
          : t(($) => $.files.saveError),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        generation.current++;
        setReading(false);
        setOpen(next);
        if (next) {
          targetVersion.current = target
            ? { id: target.id, revision: target.revision }
            : null;
          setSelection(null);
          setError("");
          setCopied(false);
        }
      }}
    >
      <DialogTrigger
        render={<Button size="sm" variant="outline" disabled={disabled} />}
      >
        <FileUp />
        {target
          ? t(($) => $.files.uploadVersion)
          : t(($) => $.files.importStrategy)}
      </DialogTrigger>
      <DialogContent className="ctf-import-dialog">
        <DialogHeader>
          <DialogTitle>
            {target
              ? t(($) => $.files.uploadVersion)
              : t(($) => $.files.importStrategy)}
          </DialogTitle>
          <DialogDescription>
            {target
              ? t(($) => $.files.versionHelp, { name: target.name })
              : t(($) => $.files.importHelp)}
          </DialogDescription>
        </DialogHeader>
        <input
          ref={input}
          type="file"
          accept=".strategy,.json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void choose(file);
          }}
        />
        <div className="ctf-import-body">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => input.current?.click()}
          >
            <FileUp />
            {selection
              ? t(($) => $.files.reselect)
              : t(($) => $.files.selectFile)}
          </Button>
          {reading && <p role="status">{t(($) => $.files.checking)}</p>}
          {selection && (
            <div className="ctf-import-preview">
              <strong className="ctf-filename">{selection.filename}</strong>
              {valid ? (
                <>
                  <p className="ctf-import-valid">
                    <Check />
                    {t(($) => $.files.ready)}
                  </p>
                  <StrategySummary strategy={valid} />
                </>
              ) : (
                issue && (
                  <div role="alert" className="ctf-import-problem">
                    <p>{t(($) => $.files.problems[issue.reason])}</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const problem = t(
                          ($) => $.files.problems[issue.reason],
                        );
                        void navigator.clipboard
                          .writeText(
                            [
                              t(($) => $.files.feedbackTitle),
                              selection.filename,
                              `Weavea World CTF · ${GAME_VERSION}`,
                              problem,
                              ...issue.details,
                            ].join("\n"),
                          )
                          .then(() => setCopied(true))
                          .catch(() => setError(t(($) => $.files.copyError)));
                      }}
                    >
                      <Copy />
                      {copied
                        ? t(($) => $.files.copied)
                        : t(($) => $.files.copyProblems)}
                    </Button>
                  </div>
                )
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="ctf-import-problem">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={saving} />}>
            {t(($) => $.cancel)}
          </DialogClose>
          <Button
            disabled={!valid || pending}
            aria-busy={saving}
            onClick={() => void save()}
          >
            {saving
              ? t(($) => $.files.saving)
              : t(($) => $.files.importAndSave)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
