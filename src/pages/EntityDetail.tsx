import { useEffect, useState } from "react";
import { useIsRestoring } from "@tanstack/react-query";
import { useLanguage } from "@/contexts/LanguageContext";
import { useParams, useNavigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { entitiesApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Loader2, Edit, StickyNote, Calendar, Trash2, Check, MoreHorizontal, ChevronDown, ChevronUp } from "@/lib/heroicons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EntitySection, EntityStatRow, EntityLinkRow, EntityDetailRow, currentStreak } from "@/components/entity/EntityParts";
import { InsightSignalBadge } from "@/components/InsightSignal";
import { ExpandableEntityDescription } from "@/components/ExpandableEntityDescription";

import { useToast } from "@/hooks/use-toast";
import { ActivityAnalyticsCalendar } from "@/components/ActivityAnalyticsCalendar";
import { EntityTypeIcon } from "@/components/ui/entity-type-icon";
import { TimerWidget } from "@/components/TimerWidget";
import { TimeHeatmap } from "@/components/TimeHeatmap";
import { ProjectDayTimeEntries } from "@/components/ProjectDayTimeEntries";
import type { HeatmapData, EntityStats } from "@/types";
import { useTimeTracking } from "@/hooks/useTimeTracking";
import { usePlanGate } from "@/hooks/usePlanGate";
import { queryClient } from "@/lib/query-client";
import { qk, STALE } from "@/lib/queries";
import { WorkspaceAssign } from "@/components/WorkspaceSwitcher";
import { MAX_ENTITY_DESCRIPTION_LENGTH } from "@/lib/entity-description";
import { formatLocalizedDate, getDateLocale } from "@/lib/date-format";


interface EntityData { id: string; title: string; type: string; description?: string; trackingDates?: string[]; createdAt: string; workspaceIds?: string[]; }

interface RelatedNote { id: string; title: string; createdAt: string; updatedAt: string; }

function DetailStat({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Calendar }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-xl bg-secondary/60 px-3 py-2.5 sm:gap-2.5 sm:px-4">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block whitespace-normal break-words text-[9px] font-medium uppercase leading-snug tracking-[0.12em] text-muted-foreground sm:text-[10px] sm:tracking-[0.16em]">{label}</span>
        <span className="mt-1 block whitespace-normal break-words font-serif text-base leading-snug text-foreground tabular-nums sm:text-lg">{value}</span>
      </span>
    </div>
  );
}

export default function EntityDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const isRestoring = useIsRestoring();
  const { applyUsageDelta, refresh: refreshUsage } = usePlanGate();
  const [entity, setEntity] = useState<EntityData | null>(() => id ? queryClient.getQueryData<EntityData>(qk.entity(id)) ?? null : null);
  const [heatmap, setHeatmap] = useState<HeatmapData>({});
  const [stats, setStats] = useState<EntityStats | null>(() => id ? queryClient.getQueryData<EntityStats>(qk.entityStats(id)) ?? null : null);
  const [loading, setLoading] = useState(() => !id || !queryClient.getQueryData(qk.entity(id)));
  const [editingTitle, setEditingTitle] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [newDescription, setNewDescription] = useState("");
  const [editingType, setEditingType] = useState(false);
  const [newType, setNewType] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [showAllEntities, setShowAllEntities] = useState(false);
  const [trackingDateBusy, setTrackingDateBusy] = useState(false);
  const [relatedNotes, setRelatedNotes] = useState<RelatedNote[]>(() => id ? queryClient.getQueryData<RelatedNote[]>(qk.entityNotes(id)) ?? [] : []);
  const [relatedEntities, setRelatedEntities] = useState<EntityData[]>(() => id
    ? (queryClient.getQueryData<EntityData[]>(qk.entityConnections(id)) ?? []).filter((item) => item.id !== id)
    : []);

  // Time tracking
  const { formatSeconds } = useTimeTracking();

  useEffect(() => {
    if (isRestoring) return;
    if (!id) return;
    let cancelled = false;
    setShowAllNotes(false);
    setShowAllEntities(false);
    const cachedEntity = queryClient.getQueryData<EntityData>(qk.entity(id));
    const cachedNotes = queryClient.getQueryData<RelatedNote[]>(qk.entityNotes(id));
    const cachedConnections = queryClient.getQueryData<EntityData[]>(qk.entityConnections(id));

    if (cachedEntity) {
      setEntity(cachedEntity);
      setLoading(false);
    } else {
      setEntity(null);
      setLoading(true);
    }
    setRelatedNotes(cachedNotes ?? []);
    setRelatedEntities((cachedConnections ?? []).filter((item) => item.id !== id));
    if (cachedEntity?.type === "ACTIVITY") {
      const cachedHeatmap = queryClient.getQueryData<unknown>(qk.entityHeatmap(id));
      const cachedStats = queryClient.getQueryData<EntityStats>(qk.entityStats(id));
      if (cachedHeatmap !== undefined) {
        setHeatmap(normalizeHeatmapData(cachedHeatmap));
      } else {
        setHeatmap(buildHeatmapFromTrackingDates(cachedEntity.trackingDates || []));
      }
      if (cachedStats) setStats(cachedStats);
      else setStats(null);
    } else {
      setHeatmap({});
      setStats(null);
    }

    const loadEntity = async () => {
      try {
        let data: EntityData;
        try {
          data = await queryClient.fetchQuery({
            queryKey: qk.entity(id),
            queryFn: () => entitiesApi.get(id).then((response) => response.data as EntityData),
            staleTime: STALE.detail,
          });
        } catch (error) {
          if (!cachedEntity) throw error;
          console.warn(`[entity detail] Refresh failed for ${id}; showing cached entity`, error);
          data = cachedEntity;
        }

        if (cancelled) {
          return;
        }

        setEntity(data);
        setLoading(false);

        const fetchDetail = async <T,>(
          queryKey: readonly unknown[],
          queryFn: () => Promise<T>,
          label: string,
        ): Promise<T | undefined> => {
          try {
            return await queryClient.fetchQuery({ queryKey, queryFn, staleTime: STALE.detail });
          } catch (error) {
            console.warn(`[entity detail] ${label} refresh failed for ${id}`, error);
            return queryClient.getQueryData<T>(queryKey);
          }
        };

        const [notesData, connectionsData, heatmapData, statsData] = await Promise.all([
          fetchDetail(qk.entityNotes(id), () => entitiesApi.getNotes(id).then((response) => response.data), "connected notes"),
          fetchDetail(qk.entityConnections(id), () => entitiesApi.getConnections(id).then((response) => response.data), "connections"),
          data.type === "ACTIVITY"
            ? fetchDetail(qk.entityHeatmap(id), () => entitiesApi.heatmap(id).then((response) => response.data), "heatmap")
            : Promise.resolve(undefined),
          data.type === "ACTIVITY"
            ? fetchDetail(qk.entityStats(id), () => entitiesApi.stats(id).then((response) => response.data as EntityStats), "statistics")
            : Promise.resolve(undefined),
        ]);

        if (cancelled) {
          return;
        }

        if (Array.isArray(notesData)) setRelatedNotes(notesData);
        if (Array.isArray(connectionsData)) {
          setRelatedEntities(connectionsData.filter((item: EntityData) => item.id !== id));
        }
        if (data.type === "ACTIVITY") {
          const apiHeatmap = normalizeHeatmapData(heatmapData);
          const trackingHeatmap = buildHeatmapFromTrackingDates(data.trackingDates || []);
          setHeatmap(Object.keys(apiHeatmap).length > 0 ? apiHeatmap : trackingHeatmap);
          if (statsData) {
            setStats({
              ...statsData,
              totalCompletions: Array.isArray(data.trackingDates)
                ? data.trackingDates.length
                : statsData.totalCompletions,
            });
          }
        } else {
          setHeatmap({});
          setStats(null);
        }
      } catch {
        if (!cancelled) {
          if (cachedEntity) {
            console.warn(`[entity detail] Could not refresh ${id}; retaining cached entity`);
          } else {
            toast({ title: t("ent_not_found"), variant: "destructive" });
            navigate("/entities");
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadEntity();

    return () => {
      cancelled = true;
    };
  }, [id, isRestoring, navigate, t, toast]);

  const normalizeHeatmapData = (payload: unknown): HeatmapData => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
    return Object.entries(payload).reduce<HeatmapData>((normalized, [key, value]) => {
      // Handle both "2026-04-12" and "2026-04-12T00:00:00.000Z" formats
      const dateKey = key.includes("T") ? key.split("T")[0] : key;
      const count = typeof value === "number" ? value : parseInt(String(value), 10);
      if (!Number.isNaN(count) && count >= 0) {
        normalized[dateKey] = (normalized[dateKey] || 0) + count;
      }
      return normalized;
    }, {});
  };

  const buildHeatmapFromTrackingDates = (dates: unknown[]): HeatmapData => {
    if (!Array.isArray(dates)) return {};
    
    const heatmap: HeatmapData = {};
    dates.forEach((date) => {
      try {
        // Handle both Date objects and ISO strings
        const dateObj = typeof date === "string" ? new Date(date) : date instanceof Date ? date : new Date(String(date));
        const dateKey = dateObj.toISOString().split("T")[0];
        heatmap[dateKey] = (heatmap[dateKey] || 0) + 1;
      } catch {
        // Skip invalid dates
      }
    });
    return heatmap;
  };

  const localToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0]; };
  const [trackDate, setTrackDate] = useState(localToday);
  const handleToggleActivityDate = async (
    date: string,
    currentlyTracked: boolean,
    successMessageKey = currentlyTracked ? "tm_day_unmarked" : "tm_day_marked",
  ) => {
    if (!id || !entity || trackingDateBusy) return;
    setTrackingDateBusy(true);
    const previousDates = entity.trackingDates ?? [];
    const nextDates = currentlyTracked
      ? previousDates.filter((trackedDate) => trackedDate.split("T")[0] !== date)
      : Array.from(new Set([...previousDates.map((trackedDate) => trackedDate.split("T")[0]), date]));
    const updateTrackingDates = (current: EntityData | undefined) =>
      current ? { ...current, trackingDates: nextDates } : current;

    setEntity((current) => updateTrackingDates(current ?? undefined) ?? null);
    setHeatmap(buildHeatmapFromTrackingDates(nextDates));
    setStats((current) => current ? { ...current, totalCompletions: nextDates.length } : current);
    queryClient.setQueryData<EntityData>(qk.entity(id), updateTrackingDates);
    queryClient.setQueryData<EntityData[]>(qk.entities(), (current) =>
      current?.map((item) => item.id === id ? { ...item, trackingDates: nextDates } : item)
    );

    try {
      const response = currentlyTracked
        ? await entitiesApi.untrack(id, date)
        : await entitiesApi.track(id, date);
      const savedEntity = response.data as EntityData;
      setEntity(savedEntity);
      setHeatmap(buildHeatmapFromTrackingDates(savedEntity.trackingDates ?? []));
      setStats((current) => current
        ? { ...current, totalCompletions: savedEntity.trackingDates?.length ?? 0 }
        : current);
      queryClient.setQueryData(qk.entity(id), savedEntity);
      queryClient.setQueryData<EntityData[]>(qk.entities(), (current) =>
        current?.map((item) => item.id === id ? { ...item, trackingDates: savedEntity.trackingDates } : item)
      );
      void queryClient.invalidateQueries({ queryKey: qk.entities() });
      toast({ title: t(successMessageKey) });
    } catch {
      setEntity((current) => current ? { ...current, trackingDates: previousDates } : current);
      setHeatmap(buildHeatmapFromTrackingDates(previousDates));
      setStats((current) => current ? { ...current, totalCompletions: previousDates.length } : current);
      queryClient.setQueryData<EntityData>(qk.entity(id), (current) =>
        current ? { ...current, trackingDates: previousDates } : current
      );
      queryClient.setQueryData<EntityData[]>(qk.entities(), (current) =>
        current?.map((item) => item.id === id ? { ...item, trackingDates: previousDates } : item)
      );
      void queryClient.invalidateQueries({ queryKey: qk.entity(id) });
      void queryClient.invalidateQueries({ queryKey: qk.entities() });
      toast({ title: t("ent_error"), variant: "destructive" });
    } finally {
      setTrackingDateBusy(false);
    }
  };
  const handleTrack = (pickedDate?: string) => {
    const date = pickedDate || localToday();
    if (entity?.trackingDates?.some((trackedDate) => trackedDate.split("T")[0] === date)) return;
    void handleToggleActivityDate(date, false, "ent_registered");
  };

  const handleSaveTitle = async () => {
    if (!id || !newTitle.trim()) return;
    try {
      const { data } = await entitiesApi.update(id, { title: newTitle.trim() });
      setEntity(data);
      queryClient.setQueryData(qk.entity(id), data);
      void queryClient.invalidateQueries({ queryKey: ["entities", "list"] });
      setEditingTitle(false);
      toast({ title: t("ent_name_updated") });
    } catch { toast({ title: t("ent_error_updating"), variant: "destructive" }); }
  };

  const handleSaveDescription = async () => {
    if (!id) return;
    try {
      const { data } = await entitiesApi.update(id, { description: newDescription.slice(0, MAX_ENTITY_DESCRIPTION_LENGTH).trim() });
      setEntity(data);
      queryClient.setQueryData(qk.entity(id), data);
      void queryClient.invalidateQueries({ queryKey: ["entities", "list"] });
      setEditingDescription(false);
      toast({ title: t("ent_description_updated") });
    } catch { toast({ title: t("ent_error_updating_description"), variant: "destructive" }); }
  };

  const handleSaveType = async () => {
    if (!id || !newType) return;
    try {
      const { data } = await entitiesApi.update(id, { type: newType });
      setEntity(data);
      queryClient.setQueryData(qk.entity(id), data);
      void queryClient.invalidateQueries({ queryKey: ["entities", "list"] });
      setEditingType(false);
      toast({ title: t("ent_type_updated") ?? "Entity type updated" });
    } catch { toast({ title: t("ent_error_updating"), variant: "destructive" }); }
  };

  const handleDeleteEntity = async () => {
    if (!id || !entity) return;
    try {
      await entitiesApi.delete(id);
      await queryClient.invalidateQueries({ queryKey: ["trash"] });
      applyUsageDelta({ entitiesCount: -1, activitiesCount: entity.type === "ACTIVITY" ? -1 : 0 });
      void refreshUsage();
      queryClient.removeQueries({ queryKey: qk.entity(id) });
      void queryClient.invalidateQueries({ queryKey: qk.entities() });
      navigate("/entities");
    } catch {
      toast({ title: t("ls_entities_error_deleting"), variant: "destructive" });
    }
  };

  if (loading)
    return (
      <AppLayout>
        <div className="mx-auto w-full max-w-6xl animate-fade-in px-4 py-8 sm:px-6">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-4 h-10 w-2/3 max-w-sm" />
          <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-44 w-full" />
            <Skeleton className="h-44 w-full" />
          </div>
          <Skeleton className="mt-4 h-56 w-full" />
        </div>
      </AppLayout>
    );
  if (!entity) return null;

  const isHabit = entity.type === "ACTIVITY";
  const isProject = entity.type === "PROJECT";
  const today = new Date().toISOString().split("T")[0];
  const trackedToday = entity.trackingDates?.some((date) => date.startsWith(today));
  const totalCompletions = entity.trackingDates?.length ?? stats?.totalCompletions ?? 0;


  const typeLabelKey = `ent_type_${entity.type.toLowerCase()}`;
  const typeLabel = t(typeLabelKey) === typeLabelKey ? entity.type.charAt(0) + entity.type.slice(1).toLowerCase() : t(typeLabelKey);
  const entityTypeOptions = [
    { value: "TOPIC", label: t("ent_type_topic") },
    { value: "PERSON", label: t("ent_type_person") },
    { value: "ORGANIZATION", label: t("ent_type_organization") },
    { value: "PROJECT", label: t("ent_type_project") },
    { value: "ACTIVITY", label: t("ent_type_activity") },
  ];

  const todayIso = localToday();
  const streak = isHabit ? currentStreak(entity.trackingDates, todayIso) : 0;
  const summary = isHabit
    ? [
        { label: t("ent_total_tracked"), value: totalCompletions },
        { label: t("ent_streak"), value: t("ent_days", { count: streak }) },
        { label: t("ent_connected_notes"), value: relatedNotes.length },
      ]
    : [
        { label: t("ent_connected_notes"), value: relatedNotes.length },
        { label: t("ent_connections"), value: relatedEntities.length },
        { label: t("ent_created"), value: formatLocalizedDate(entity.createdAt, language, { month: "short", day: "numeric" }) },
      ];
  const typeName = (type: string) => {
    const key = `ent_type_${type.toLowerCase()}`;
    return t(key) === key ? type.charAt(0) + type.slice(1).toLowerCase() : t(key);
  };
  const shownNotes = showAllNotes ? relatedNotes : relatedNotes.slice(0, 2);
  const shownEntities = showAllEntities ? relatedEntities : relatedEntities.slice(0, 2);
  const startEditTitle = () => { setEditingTitle(true); setNewTitle(entity.title); };
  const startEditDescription = () => { setEditingDescription(true); setNewDescription(entity.description?.slice(0, MAX_ENTITY_DESCRIPTION_LENGTH) || ""); };

  const linksColumn = (
    <>
      <EntitySection title={t("ent_connected_notes")} aside={relatedNotes.length}>
        <div className="px-1">
          {relatedNotes.length > 0 ? shownNotes.map((note) => (
            <EntityLinkRow
              key={note.id}
              icon={<StickyNote className="h-3.5 w-3.5" />}
              title={note.title || t("notes_untitled")}
              meta={t("ent_updated", { date: formatLocalizedDate(note.updatedAt, language) })}
              onClick={() => navigate(`/notes/${note.id}`)}
            />
          )) : <p className="py-3 text-sm text-muted-foreground">{t("ent_no_connected_notes")}</p>}
        </div>
        {relatedNotes.length > 2 && (
          <Button variant="quiet" size="sm" className="rounded-full" aria-expanded={showAllNotes} onClick={() => setShowAllNotes((v) => !v)}>
            {showAllNotes ? t("ent_show_less") : t("ent_show_all", { count: relatedNotes.length })}
            {showAllNotes ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        )}
      </EntitySection>

      <EntitySection title={t("ent_connected_entities")} aside={relatedEntities.length}>
        <div className="px-1">
          {relatedEntities.length > 0 ? shownEntities.map((ent) => (
            <EntityLinkRow
              key={ent.id}
              icon={<EntityTypeIcon type={ent.type} className="h-3.5 w-3.5" />}
              title={ent.title}
              meta={typeName(ent.type)}
              onClick={() => navigate(`/entities/${ent.id}`)}
            />
          )) : <p className="py-3 text-sm text-muted-foreground">{t("ent_no_connected_entities")}</p>}
        </div>
        {relatedEntities.length > 2 && (
          <Button variant="quiet" size="sm" className="rounded-full" aria-expanded={showAllEntities} onClick={() => setShowAllEntities((v) => !v)}>
            {showAllEntities ? t("ent_show_less") : t("ent_show_all", { count: relatedEntities.length })}
            {showAllEntities ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        )}
      </EntitySection>
    </>
  );

  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
        {/* Top bar */}
        <div className="mb-6 flex items-center justify-between gap-2">
          <Button
            variant="quiet"
            size="sm"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/entities"))}
            className="h-auto rounded-full px-3 py-1.5"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {t("ent_back")}
          </Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="iconSm" className="rounded-full text-muted-foreground" aria-label={t("ent_more_actions")}>
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={startEditTitle}><Edit className="mr-2 h-4 w-4" /> {t("ent_edit_name")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={startEditDescription}><Edit className="mr-2 h-4 w-4" /> {t("ent_edit_description")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDeleteDialogOpen(true)} className="text-destructive focus:text-destructive">
                <Trash2 className="mr-2 h-4 w-4" /> {t("common_delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Header */}
        <header className="mb-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/10 bg-secondary/50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <EntityTypeIcon type={entity.type} className="h-3.5 w-3.5" /> {typeLabel}
            </span>
            <InsightSignalBadge kind="entity" id={entity.id} />
          </div>

          {editingTitle ? (
            <div className="flex flex-wrap gap-2">
              <Input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleSaveTitle(); }} placeholder={t("ent_new_name_placeholder")} className="min-w-0 flex-1" />
              <Button size="sm" onClick={handleSaveTitle}>{t("ent_save")}</Button>
              <Button size="sm" variant="outline" onClick={() => { setEditingTitle(false); setNewTitle(entity.title); }}>{t("ent_cancel")}</Button>
            </div>
          ) : (
            <h1 onClick={startEditTitle} className="cursor-text break-words font-serif text-3xl leading-tight tracking-tight text-foreground sm:text-5xl">
              {entity.title}
            </h1>
          )}

          {editingDescription ? (
            <div className="mt-4 flex flex-col gap-2">
              <Textarea autoFocus value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder={t("ent_add_description_placeholder")} className="text-sm" rows={3} maxLength={MAX_ENTITY_DESCRIPTION_LENGTH} />
              <p className="text-right text-[10px] text-muted-foreground">{t("ent_description_character_count", { count: newDescription.length })}</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveDescription}>{t("ent_save")}</Button>
                <Button size="sm" variant="outline" onClick={() => setEditingDescription(false)}>{t("ent_cancel")}</Button>
              </div>
            </div>
          ) : entity.description ? (
            <div className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              <ExpandableEntityDescription key={entity.id} description={entity.description} />
            </div>
          ) : (
            <button type="button" onClick={startEditDescription} className="mt-3 text-sm italic text-muted-foreground/60 hover:text-muted-foreground">
              {t("ent_add_description_placeholder")}
            </button>
          )}

          <div className="mt-6"><EntityStatRow stats={summary} /></div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
          <div className="min-w-0 space-y-8">
            {isProject && (
              <EntitySection title={t("ent_section_time")}>
                <div className="space-y-4">
                  <TimerWidget
                    entityId={id!}
                    entityName={entity.title}
                    showSectionBorders={false}
                    onTimerStart={() => toast({ title: t("ent_timer_started") })}
                    onTimerStop={(duration) => toast({ title: t("ent_timer_stopped", { duration: formatSeconds(duration) }) })}
                  />
                  <TimeHeatmap entityId={id!} />
                </div>
              </EntitySection>
            )}

            {isHabit && (
              <EntitySection title={t("ent_section_tracking")}>
                <div className="space-y-4 rounded-2xl border border-border/10 bg-secondary/30 p-4">
                  <Button
                    className="h-11 w-full rounded-xl"
                    variant={trackedToday ? "outline" : "default"}
                    disabled={trackedToday || trackingDateBusy}
                    onClick={() => handleTrack(todayIso)}
                  >
                    {trackedToday ? <><Check className="h-4 w-4" /> {t("tm_done_today")}</> : t("ent_mark_today")}
                  </Button>
                  <ActivityAnalyticsCalendar
                    trackingDates={entity.trackingDates}
                    isUpdating={trackingDateBusy}
                    onToggleDate={(date, currentlyTracked) => {
                      if (!trackingDateBusy) void handleToggleActivityDate(date, currentlyTracked);
                    }}
                  />
                  <div className="flex flex-col gap-2 border-t border-border/10 pt-4 sm:flex-row sm:items-center">
                    <span className="text-xs text-muted-foreground sm:mr-auto">{t("ent_log_other_date")}</span>
                    <Input type="date" lang={getDateLocale(language)} value={trackDate} max={todayIso} onChange={(e) => setTrackDate(e.target.value)} className="h-9 w-full sm:w-auto" aria-label={t("tm_date")} />
                    <Button size="sm" variant="outline" className="h-9 rounded-xl" onClick={() => handleTrack(trackDate)} disabled={!trackDate || trackDate > todayIso || trackingDateBusy}>
                      {t("ent_save")}
                    </Button>
                  </div>
                </div>
              </EntitySection>
            )}

            {!isProject && !isHabit && linksColumn}
          </div>

          <aside className="min-w-0 space-y-8">
            {(isProject || isHabit) && linksColumn}

            <EntitySection title={t("ent_section_details")}>
              <div className="overflow-hidden rounded-2xl border border-border/10 bg-secondary/30">
                <EntityDetailRow label={t("ent_type")}>
                  <div className="flex items-center gap-2 sm:justify-end">
                    <select
                      value={editingType ? newType : entity.type}
                      onChange={(e) => { setNewType(e.target.value); setEditingType(e.target.value !== entity.type); }}
                      className="h-9 rounded-xl border border-border/10 bg-background px-2 text-sm text-foreground"
                      aria-label={t("ent_type")}
                    >
                      {entityTypeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {editingType && <Button size="sm" onClick={handleSaveType}>{t("ent_save")}</Button>}
                  </div>
                </EntityDetailRow>
                <EntityDetailRow label={t("ent_created")}>{formatLocalizedDate(entity.createdAt, language)}</EntityDetailRow>
                <div className="px-4 py-3.5">
                  <WorkspaceAssign key={entity.id} kind="ENTITY" id={entity.id} value={entity.workspaceIds} />
                </div>
              </div>
            </EntitySection>
          </aside>
        </div>
      </div>
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t("entities_delete_one_title")}
        description={t("entities_delete_one_desc", { title: entity.title || t("notes_untitled") })}
        confirmText={t("common_delete")}
        destructive
        onConfirm={handleDeleteEntity}
      />
    </AppLayout>
  );
}
