import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AgentTypeInfo, ModelInfo } from "../../types.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Dialog } from "../../components/ui/dialog.js";
import { Input, Textarea } from "../../components/ui/input.js";
import { Select } from "../../components/ui/select.js";

type TemplateAudience = "spawned" | "orchestrator" | "all";
type TemplateAutoApply = "none" | "spawned" | "all";
export type TemplateInfo = { name: string; description: string; items: string[]; audience?: TemplateAudience; autoApply?: TemplateAutoApply; applyToAll?: boolean; validationErrors?: string[]; source: string; filePath: string };

function templateAudience(template: TemplateInfo): TemplateAudience {
  return template.audience || "spawned";
}

function isSpawnedTemplate(template: TemplateInfo): boolean {
  const audience = templateAudience(template);
  return audience === "spawned" || audience === "all";
}

function splitItems(text: string): string[] {
  return text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
}

function toggleItemText(text: string, item: string): string {
  const items = splitItems(text);
  const exists = items.includes(item);
  const next = exists ? items.filter((value) => value !== item) : [...items, item];
  return next.join("\n");
}

async function responseErrorText(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    return data?.error || text;
  } catch {
    return text;
  }
}

function FieldLabel({ children, required, optional }: { children: ReactNode; required?: boolean; optional?: boolean }) {
  return <label className="block text-xs uppercase tracking-wide text-muted-foreground">{children} {required && <span className="text-destructive">*</span>}{optional && <span className="normal-case text-muted-foreground/70">(optional)</span>}</label>;
}

function FormMessage({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" | "success" }) {
  const className = tone === "error" ? "text-destructive" : tone === "success" ? "text-emerald-400" : "text-muted-foreground";
  return <p className={`text-xs ${className}`}>{children}</p>;
}

function ValidationSummary({ errors, serverError }: { errors: string[]; serverError?: string }) {
  if (!errors.length && !serverError) return null;
  return <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
    {serverError && <div>{serverError}</div>}
    {!!errors.length && <ul className="list-disc pl-5">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
  </div>;
}

const spawnableAgentClasses = ["lead", "scout", "implementer", "reviewer"] as const;

export function AgentTypesPanel({ types, onNew, onEdit, large }: { types: AgentTypeInfo[]; onNew: () => void; onEdit: (type: AgentTypeInfo) => void; large?: boolean }) {
  return (
    <Card className={large ? "min-h-[70vh]" : ""}>
      <CardHeader className="border-b border-border"><div className="flex items-center justify-between gap-3"><CardTitle>Agent Types</CardTitle><Button variant="secondary" className="px-2 py-1 text-xs" onClick={onNew}>+ New Type</Button></div></CardHeader>
      <CardContent className="pt-4">
        {!types.length ? <p className="text-sm text-muted-foreground">No agent types found.</p> : <div className="grid gap-3 md:grid-cols-2">
          {types.map((type) => (
            <div key={type.name} className="rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold">{type.name}</span>{type.agentClass && <Badge variant="outline">{type.agentClass}</Badge>}</div><div className="mt-1 line-clamp-3 text-xs text-muted-foreground">{type.description}</div></div><Button variant="secondary" className="shrink-0 px-2 py-1 text-xs" onClick={() => onEdit(type)}>Edit</Button></div>
            </div>
          ))}
        </div>}
      </CardContent>
    </Card>
  );
}


function TemplateChips({ templates, selectedText, emptyText, onToggle }: { templates: TemplateInfo[]; selectedText: string; emptyText: string; onToggle: (name: string) => void }) {
  const selected = new Set(splitItems(selectedText));
  return <div className="space-y-2"><div className="text-xs text-muted-foreground">Click to assign/unassign existing templates.</div><div className="flex flex-wrap gap-1">{templates.length ? templates.map((template) => {
    const active = selected.has(template.name);
    return <button key={template.name} type="button" title={template.description} className={`rounded-full border px-2 py-1 text-xs transition ${active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`} onClick={() => onToggle(template.name)}>{active ? "✓ " : ""}{template.name}</button>;
  }) : <span className="text-xs text-muted-foreground">{emptyText}</span>}</div></div>;
}

export function TypeEditorDialog({ open, typeDef, models, skillTemplates, extensionTemplates, onClose, onSaved }: { open: boolean; typeDef?: AgentTypeInfo; models: ModelInfo[]; skillTemplates: TemplateInfo[]; extensionTemplates: TemplateInfo[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentClass, setAgentClass] = useState<(typeof spawnableAgentClasses)[number]>("implementer");
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("");
  const [skillTemplatesText, setSkillTemplatesText] = useState("");
  const [extensionTemplatesText, setExtensionTemplatesText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [serverError, setServerError] = useState("");
  useEffect(() => {
    if (!open) return;
    setName(typeDef?.name || "");
    setDescription(typeDef?.description || "");
    setAgentClass(spawnableAgentClasses.includes(typeDef?.agentClass as any) ? typeDef!.agentClass as (typeof spawnableAgentClasses)[number] : "implementer");
    setModel(typeDef?.model || "");
    setThinking(typeDef?.thinking || "medium");
    setSkillTemplatesText((typeDef?.skillTemplates || []).join("\n"));
    setExtensionTemplatesText((typeDef?.extensionTemplates || []).join("\n"));
    setPrompt("");
    setServerError("");
  }, [open, typeDef]);
  const selectedModel = models.find((m) => m.id === model);
  const levels = selectedModel?.thinkingLevels || ["off", "minimal", "low", "medium", "high", "xhigh"];
  const errors = [
    !name.trim() ? "Name is required." : undefined,
    !description.trim() ? "Description is required." : undefined,
  ].filter(Boolean) as string[];
  const save = async () => {
    setServerError("");
    if (errors.length) return;
    const payload = { name: name.trim(), description: description.trim(), agentClass, model: model || undefined, thinking: selectedModel?.thinking ? thinking : undefined, skillTemplates: splitItems(skillTemplatesText), extensionTemplates: splitItems(extensionTemplatesText), prompt: prompt.trim() || undefined };
    const res = await fetch("/api/agent-types", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) return setServerError("Failed to save: " + await responseErrorText(res));
    onSaved();
  };
  const spawnedSkillTemplates = skillTemplates.filter(isSpawnedTemplate);
  const spawnedExtensionTemplates = extensionTemplates.filter(isSpawnedTemplate);
  return <Dialog open={open} title={typeDef ? `Edit ${typeDef.name}` : "New Agent Type"} onOpenChange={onClose}>
    <div className="space-y-3">
      <FieldLabel required>Name</FieldLabel><Input value={name} onChange={(e) => setName(e.target.value)} readOnly={!!typeDef} aria-invalid={!name.trim()} className={!name.trim() ? "border-destructive/60" : undefined} />
      <FieldLabel required>Description</FieldLabel><Input value={description} onChange={(e) => setDescription(e.target.value)} aria-invalid={!description.trim()} className={!description.trim() ? "border-destructive/60" : undefined} />
      <FieldLabel required>Agent class</FieldLabel><Select value={agentClass} onChange={(e) => setAgentClass(e.target.value as (typeof spawnableAgentClasses)[number])}>{spawnableAgentClasses.map((value) => <option key={value} value={value}>{value}</option>)}</Select>
      <FormMessage>Choose what kind of child agent this type can spawn as. The root orchestrator role is reserved for the interactive /orchestrate session and is not spawnable.</FormMessage>
      <FieldLabel optional>Model</FieldLabel><Select value={model} onChange={(e) => setModel(e.target.value)}><option value="">-- default --</option>{models.map((m) => <option key={m.id} value={m.id}>{m.provider ? `${m.provider}/${m.id}` : m.id}</option>)}</Select>
      {selectedModel?.thinking && <><FieldLabel optional>Thinking Level</FieldLabel><Select value={thinking} onChange={(e) => setThinking(e.target.value)}>{levels.map((level) => <option key={level} value={level}>{level}</option>)}</Select></>}
      <FieldLabel optional>Skill Templates</FieldLabel><Textarea rows={3} value={skillTemplatesText} onChange={(e) => setSkillTemplatesText(e.target.value)} placeholder={spawnedSkillTemplates.map((template) => template.name).join(", ") || "common, frontend"} />
      <TemplateChips templates={spawnedSkillTemplates} selectedText={skillTemplatesText} emptyText="No spawned-agent skill templates defined yet." onToggle={(name) => setSkillTemplatesText((prev) => toggleItemText(prev, name))} />
      <FieldLabel optional>Extension Templates</FieldLabel><Textarea rows={3} value={extensionTemplatesText} onChange={(e) => setExtensionTemplatesText(e.target.value)} placeholder={spawnedExtensionTemplates.map((template) => template.name).join(", ") || "browser-tools"} />
      <TemplateChips templates={spawnedExtensionTemplates} selectedText={extensionTemplatesText} emptyText="No extension templates defined yet." onToggle={(name) => setExtensionTemplatesText((prev) => toggleItemText(prev, name))} />
      <FieldLabel optional>Prompt / Instructions</FieldLabel><Textarea rows={7} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <ValidationSummary errors={errors} serverError={serverError} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!!errors.length}>Save Type</Button></div>
    </div>
  </Dialog>;
}
