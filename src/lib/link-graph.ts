/**
 * 문서 링크 그래프 — 백링크·나가는 링크·그래프(전체/로컬) 계산.
 *
 * 입력은 검색 색인의 스냅숏(`getLinkSnapshot()`)뿐이다. 파일 시스템을 훑지 않는다(ADR-007).
 * 링크는 **해석 전** 값으로 저장돼 있으므로 여기서 한 번에 해석한다. 결과는 색인 버전이
 * 바뀔 때까지 캐시한다 — 문서 수천 개 수준에서 해석은 수 ms지만 요청마다 반복할 이유가 없다.
 *
 * 노드 종류:
 *   - `doc`   색인된 문서
 *   - `ghost` 링크는 있지만 아직 없는 문서(Obsidian의 회색 노드). id = `ghost:<대상>`
 *   - `tag`   frontmatter 태그 (요청 시에만). id = `tag:<태그>`
 */

import 'server-only';

import { isVersionBackup } from './file-utils';
import { getIndexVersion, getLinkSnapshot, type LinkSnapshot } from './search-index';
import { buildWikiIndex, resolveWikiTarget } from './wikilinks';

import type {
  BacklinkEntry,
  GraphEdge,
  GraphNode,
  GraphResponse,
  LinksResponse,
  OutgoingLinkEntry,
} from '@/types/api';

/** 그래프 응답 노드 상한. 넘으면 연결이 많은 노드부터 남기고 `truncated`를 켠다. */
export const GRAPH_MAX_NODES = 1500;

/** 로컬 그래프 깊이 상한. */
export const GRAPH_MAX_DEPTH = 3;

interface ResolvedEdge {
  source: string;
  /** 해석된 문서 subpath, 또는 `ghost:<대상>` */
  target: string;
  kind: 'wiki' | 'md';
  /** 원문 대상 키 (위키링크 키 또는 md 링크의 해석 경로) */
  raw: string;
  context: string;
}

interface ResolvedGraph {
  version: number;
  titles: Map<string, string>;
  tags: Map<string, string[]>;
  edges: ResolvedEdge[];
  outgoing: Map<string, ResolvedEdge[]>;
  incoming: Map<string, ResolvedEdge[]>;
}

let cache: ResolvedGraph | null = null;

function ghostId(raw: string): string {
  return `ghost:${raw}`;
}

function resolveSnapshot(snapshot: LinkSnapshot): ResolvedGraph {
  const titles = new Map<string, string>();
  const tags = new Map<string, string[]>();
  for (const doc of snapshot.docs) {
    // 저장할 때마다 같은 폴더에 남는 이전 버전(`이름_YYYYMMDD-HHmmss.md`)은 문서가 아니다.
    // 파일 목록이 숨기는 것과 같은 기준으로 그래프·백링크에서도 뺀다 — 넣으면 저장할 때마다
    // 같은 링크를 가진 복제 노드가 생기고 백링크에 옛 버전이 섞인다.
    if (isVersionBackup(doc.subpath.slice(doc.subpath.lastIndexOf('/') + 1))) continue;
    titles.set(doc.subpath, doc.title);
    tags.set(doc.subpath, doc.tags);
  }

  const wikiIndex = buildWikiIndex(titles.keys());
  // md 링크 대상은 NFC로 정규화돼 저장된다. macOS 파일명은 NFD일 수 있으므로 NFC 키로 맞춘다.
  const byNfc = new Map<string, string>();
  for (const sub of titles.keys()) byNfc.set(sub.normalize('NFC'), sub);
  const edges: ResolvedEdge[] = [];
  const outgoing = new Map<string, ResolvedEdge[]>();
  const incoming = new Map<string, ResolvedEdge[]>();
  const seen = new Set<string>();

  for (const link of snapshot.links) {
    // 색인에서 빠진 원본(삭제 직후 등)의 링크는 버린다.
    if (!titles.has(link.source)) continue;

    let resolved: string | null;
    if (link.kind === 'wiki') {
      resolved = resolveWikiTarget(link.target, link.source, wikiIndex);
    } else {
      resolved = byNfc.get(link.target.normalize('NFC')) ?? null;
    }
    const target = resolved ?? ghostId(link.target);

    // 자기 자신을 가리키는 링크와, 같은 쌍의 중복(위키+md로 두 번)은 하나로 본다.
    if (target === link.source) continue;
    const pairKey = `${link.source}\u0000${target}`;
    const duplicate = seen.has(pairKey);
    seen.add(pairKey);

    const edge: ResolvedEdge = {
      source: link.source,
      target,
      kind: link.kind,
      raw: link.target,
      context: link.context,
    };

    const out = outgoing.get(link.source);
    if (out) out.push(edge);
    else outgoing.set(link.source, [edge]);

    if (duplicate) continue;
    edges.push(edge);
    const inc = incoming.get(target);
    if (inc) inc.push(edge);
    else incoming.set(target, [edge]);
  }

  return { version: snapshot.version, titles, tags, edges, outgoing, incoming };
}

/** 색인 버전이 바뀌었을 때만 다시 해석한다. */
function getResolved(): ResolvedGraph {
  // 버전 0 = DB가 아직 열리지 않음. 스냅숏이 DB를 열며 버전을 1 이상으로 올린다.
  const version = getIndexVersion();
  if (cache && version !== 0 && cache.version === version) return cache;
  cache = resolveSnapshot(getLinkSnapshot());
  return cache;
}

/** 테스트 전용 — 캐시를 비운다. */
export function resetLinkGraphCacheForTest(): void {
  cache = null;
}

// ---------------------------------------------------------------------------
// 백링크 · 나가는 링크
// ---------------------------------------------------------------------------

/**
 * 문서 하나의 나가는 링크와 백링크.
 * 나가는 링크는 뷰어가 `[[…]]`를 실제 문서로 연결할 때 쓴다(`raw` → `resolved`).
 */
export function getLinksFor(subpath: string): LinksResponse {
  const graph = getResolved();

  const outgoing: OutgoingLinkEntry[] = (graph.outgoing.get(subpath) ?? []).map((edge) => {
    const isDoc = graph.titles.has(edge.target);
    return {
      kind: edge.kind,
      raw: edge.raw,
      resolved: isDoc ? edge.target : null,
      ...(isDoc ? { title: graph.titles.get(edge.target) } : {}),
    };
  });

  const backlinks: BacklinkEntry[] = (graph.incoming.get(subpath) ?? [])
    .map((edge) => ({
      source: edge.source,
      title: graph.titles.get(edge.source) ?? edge.source,
      context: edge.context,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, 'ko'));

  return { path: subpath, indexed: graph.titles.has(subpath), outgoing, backlinks };
}

// ---------------------------------------------------------------------------
// 그래프
// ---------------------------------------------------------------------------

export interface GraphOptions {
  /** 중심 문서. 없으면 전체 그래프. */
  center?: string;
  /** 로컬 그래프 깊이 (1~`GRAPH_MAX_DEPTH`). */
  depth?: number;
  /** 태그 노드 포함 여부. */
  includeTags?: boolean;
}

function labelFor(id: string, titles: Map<string, string>): string {
  if (id.startsWith('ghost:')) return id.slice('ghost:'.length);
  if (id.startsWith('tag:')) return `#${id.slice('tag:'.length)}`;
  return titles.get(id) ?? id;
}

function typeFor(id: string): GraphNode['type'] {
  if (id.startsWith('ghost:')) return 'ghost';
  if (id.startsWith('tag:')) return 'tag';
  return 'doc';
}

export function getGraph(options: GraphOptions = {}): GraphResponse {
  const graph = getResolved();

  // 무방향 인접 목록 (문서·유령 노드)
  const edgeList: GraphEdge[] = graph.edges.map((e) => ({ source: e.source, target: e.target }));
  if (options.includeTags) {
    for (const [doc, docTags] of graph.tags) {
      for (const tag of docTags) edgeList.push({ source: doc, target: `tag:${tag}` });
    }
  }

  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    let set = adjacency.get(a);
    if (!set) adjacency.set(a, (set = new Set()));
    set.add(b);
  };
  for (const e of edgeList) {
    link(e.source, e.target);
    link(e.target, e.source);
  }

  // 대상 노드 집합
  let nodeIds: Set<string>;
  if (options.center) {
    const depth = Math.min(Math.max(options.depth ?? 1, 1), GRAPH_MAX_DEPTH);
    nodeIds = new Set([options.center]);
    let frontier = [options.center];
    for (let level = 0; level < depth; level += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        // 태그 노드는 지나가지 않는다 — 태그 하나가 문서 수백 개를 한 번에 끌어온다.
        if (id.startsWith('tag:') && id !== options.center) continue;
        for (const neighbor of adjacency.get(id) ?? []) {
          if (!nodeIds.has(neighbor)) {
            nodeIds.add(neighbor);
            next.push(neighbor);
          }
        }
      }
      frontier = next;
    }
  } else {
    // 전체 그래프: 연결 없는 문서도 점으로 보여준다(Obsidian과 같다).
    nodeIds = new Set([...graph.titles.keys(), ...adjacency.keys()]);
  }

  const degreeOf = (id: string) => adjacency.get(id)?.size ?? 0;

  let truncated = false;
  if (nodeIds.size > GRAPH_MAX_NODES) {
    truncated = true;
    const kept = [...nodeIds]
      .sort((a, b) => {
        if (a === options.center) return -1;
        if (b === options.center) return 1;
        return degreeOf(b) - degreeOf(a);
      })
      .slice(0, GRAPH_MAX_NODES);
    nodeIds = new Set(kept);
  }

  const nodes: GraphNode[] = [...nodeIds].map((id) => ({
    id,
    label: labelFor(id, graph.titles),
    type: typeFor(id),
    degree: degreeOf(id),
  }));

  const edges = edgeList.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  return {
    ...(options.center ? { center: options.center } : {}),
    nodes,
    edges,
    ...(truncated ? { truncated: true } : {}),
  };
}
