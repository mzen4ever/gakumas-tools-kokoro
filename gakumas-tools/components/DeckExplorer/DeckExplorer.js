"use client";
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { Tooltip } from "react-tooltip";
import {
  IdolConfig,
  StageConfig,
  IdolStageConfig,
  STRATEGIES,
} from "gakumas-engine";

import Button from "@/components/Button";
import Input from "@/components/Input";
import KofiAd from "@/components/KofiAd";
import Loader from "@/components/Loader";
import LoadoutSkillCardGroup from "@/components/LoadoutSkillCardGroup";
import ParametersInput from "@/components/ParametersInput";
import StagePItems from "@/components/StagePItems";
import StageSkillCards from "@/components/StageSkillCards";
import StageSelect from "@/components/StageSelect";
import EntityIcon from "@/components/EntityIcon";

import { SkillCards } from "gakumas-data";
import { getBaseId } from "gakumas-engine/utils";

import LoadoutContext from "@/contexts/LoadoutContext";
import WorkspaceContext from "@/contexts/WorkspaceContext";

import { simulate } from "@/simulator";
import { MAX_WORKERS } from "@/simulator/constants";
import {
  getIndications,
  loadoutFromSearchParams,
  getSimulatorUrl,
} from "@/utils/simulator";
import { getDeckExplorerUrl } from "@/utils/deckexplorer";
import { formatStageShortName } from "@/utils/stages";
import { EntityTypes } from "@/utils/entities";

import DeckExplorerSubTools from "@/components/DeckExplorer/DeckExplorerSubTools";
import styles from "@/components/DeckExplorer/DeckExplorer.module.scss";

import { useSearchParams } from "next/navigation";

const DEFAULT_NUM_RUNS = 200;

function generateItemCombos(currentItems, candidates) {
  const usedItems = currentItems.filter((id) => id != null && id !== 0);
  if (usedItems.length === 0) return [];

  const fixed = usedItems[0];
  const variableSlotCount = usedItems.length - 1;

  const usable = Array.from(
    new Set([...usedItems.slice(1), ...candidates].filter((id) => id != null && id !== 0 && id !== fixed))
  );

  const results = [];

  const pick = (current, start = 0) => {
    if (current.length === variableSlotCount) {
      const combo = [fixed, ...current];
      results.push(combo);
      return;
    }
    for (let i = start; i < usable.length; i++) {
      pick([...current, usable[i]], i + 1);
    }
  };

  pick([]);
  return results;
}

export default function DeckExplorer() {
  const t = useTranslations("Simulator");
  const searchParams = useSearchParams();

  const {
    stage,
    loadout,
    setSupportBonus,
    setParams,
    replacePItemId,
    setLoadout,
  } = useContext(LoadoutContext);
  const { idolId } = useContext(WorkspaceContext);

  const [strategy, setStrategy] = useState("HeuristicStrategy");
  const [simulatorData, setSimulatorData] = useState(null);
  const [itemCandidates, setItemCandidates] = useState([null, null, null]);
  const [cardCandidates, setCardCandidates] = useState([null, null, null]); // カード候補
  const [cardCustomizationsList, setCardCustomizationsList] = useState([[], [], []]); // カード候補のカスタマイズ、cardCandidatesと数合わせる
  const [customizationLimit, setCustomizationLimit] = useState(1);
  const [explorationMode, setExplorationMode] = useState("item");
  const [initialCombos, setInitialCombos] = useState([]);
  const [comboPoints, setComboPoints] = useState(new Map()); // 組み合わせが持つポイント
  const [sortByPoints, setSortByPoints] = useState(false); // ポイント順にソート
  const [comboTrialCounts, setComboTrialCounts] = useState(new Map()); // 累計試行回数
  const [retrySetCount, setRetrySetCount] = useState(1); // 再試行のマルチセット回数
  const [targetSlotCount, setTargetSlotCount] = useState(2); // 入替先スロット候補
  const [running, setRunning] = useState(false);
  const [topCombos, setTopCombos] = useState([]);
  const [savedLoadout, setSavedLoadout] = useState(null);
  const [numRuns, setNumRuns] = useState(DEFAULT_NUM_RUNS);
  const [sharedUrlInput, setSharedUrlInput] = useState("");
  const workersRef = useRef();

  const config = useMemo(() => {
    const idolConfig = new IdolConfig(loadout);
    const stageConfig = new StageConfig(stage);
    return new IdolStageConfig(idolConfig, stageConfig);
  }, [loadout, stage]);

  // 組み合わせ表示
  const displayCombos = useMemo(() => {
    const list = [...topCombos];
    if (sortByPoints && comboPoints) {
      list.sort((a, b) => {
        const aPts = comboPoints.get(getLoadoutKey(a.result.loadout)) || 0;
        const bPts = comboPoints.get(getLoadoutKey(b.result.loadout)) || 0;
        return bPts - aPts;
      });
    }
    return list;
  }, [topCombos, sortByPoints, comboPoints]);

  const deckExplorerUrl = useMemo(() => {
    if (!loadout || typeof loadout !== "object" || loadout.stageId == null) {
      return "";
    }
    return getDeckExplorerUrl(loadout);
  }, [loadout]);

  const simulatorUrl = useMemo(() => {
    if (!loadout || typeof loadout !== "object" || loadout.stageId == null) {
      return "";
    }
    return getSimulatorUrl(loadout);
  }, [loadout]);

  const { pItemIndications, skillCardIndicationGroups } = getIndications(
    config,
    loadout
  );

  useEffect(() => {
    const parsed = loadoutFromSearchParams(searchParams);
    if (parsed?.hasDataFromParams) {
      setLoadout(fixLoadout(parsed));  // ← ここで wrap する
    }
  }, []);
    

  useEffect(() => {
    let numWorkers = 1;
    if (navigator.hardwareConcurrency) {
      numWorkers = Math.min(navigator.hardwareConcurrency, MAX_WORKERS);
    }
    workersRef.current = [];
    for (let i = 0; i < numWorkers; i++) {
      workersRef.current.push(
        new Worker(new URL("../../simulator/worker.js", import.meta.url))
      );
    }
    return () => workersRef.current?.forEach((worker) => worker.terminate());
  }, []);

  function fixLoadout(loadout) {
    if (!loadout.memorySets && loadout.skillCardIdGroups) {
      loadout.memorySets = loadout.skillCardIdGroups.map((group) => ({
        cards: group,
      }));
    }
    return loadout;
  }

  function replaceItemCandidate(index, id) {
    const updated = [...itemCandidates];
    updated[index] = id;
    setItemCandidates(updated);
  }

  function replaceCardSwapCandidate(index, cardId) {
    console.log(`カード候補スロット[${index}] にカードID ${cardId} をセット`);
    const updated = [...cardCandidates];
    updated[index] = cardId;
    setCardCandidates(updated);
  }

  function replaceCardCustomizations(index, customizations) {
    setCardCustomizationsList((prev) => {
      const updated = [...prev];
      updated[index] = customizations;
      return updated;
    });
  }

  function countCustomizations(customizations) {
    if (!Array.isArray(customizations)) return 0;
    return [2, 3, 4, 5].reduce((count, index) => {
      const c = customizations[index];
      return count + (c && typeof c === "object" && Object.keys(c).length > 0 ? 1 : 0);
    }, 0);
  }

  function hasDuplicateUniqueCardsAcrossLoadout(loadout, replacementCards, replacementSlots) {
    const baseIds = new Set();

    // 既存構成の非置換カードをチェック
    for (let gi = 0; gi < loadout.memorySets.length; gi++) {
      const cards = loadout.memorySets[gi]?.cards || [];
      for (let si = 0; si < cards.length; si++) {
        const isReplacing = replacementSlots.some(
          ({ groupIndex, slotIndex }) => groupIndex === gi && slotIndex === si
        );
        if (isReplacing) continue;

        const cardId = cards[si];
        const card = SkillCards.getById(cardId);
        if (card?.unique) {
          const baseId = getBaseId(card);
          if (baseIds.has(baseId)) return true;
          baseIds.add(baseId);
        }
      }
    }

    // 差し替えカードをチェック
    for (const { cardId } of replacementCards) {
      const card = SkillCards.getById(cardId);
      if (card?.unique) {
        const baseId = getBaseId(card);
        if (baseIds.has(baseId)) return true;
        baseIds.add(baseId);
      }
    }

    return false;
  }

  function combinations(array, k) {
    const result = [];
    function backtrack(start, combo) {
      if (combo.length === k) {
        result.push([...combo]);
        return;
      }
      for (let i = start; i < array.length; i++) {
        combo.push(array[i]);
        backtrack(i + 1, combo);
        combo.pop();
      }
    }
    backtrack(0, []);
    return result;
  }

  function permutations(array, k) {
    const result = [];
    function backtrack(path, used) {
      if (path.length === k) {
        result.push([...path]);
        return;
      }
      for (let i = 0; i < array.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        path.push(array[i]);
        backtrack(path, used);
        path.pop();
        used[i] = false;
      }
    }
    backtrack([], Array(array.length).fill(false));
    return result;
  }

  function getLoadoutKey(loadout) {
    if (!loadout || !Array.isArray(loadout.memorySets)) return "";

    const sortedSets = loadout.memorySets.map((set, gi) => {
      const cardPairs = set.cards.map((cardId, si) => ({
        cardId,
        customization: loadout.customizationGroups?.[gi]?.[si] || {},
      }));
      return cardPairs
        .filter((p) => typeof p.cardId === "number")
        .sort((a, b) => a.cardId - b.cardId);
    });

    return JSON.stringify({
      normalizedCardCustomizations: sortedSets,
      pItemIds: loadout.pItemIds,
    });
  }

  async function readFromClipboardAndParse() {
    try {
      const text = await navigator.clipboard.readText();
      if (!/^https?:\/\/.+/i.test(text)) {
        alert("有効な URL ではありません。");
        return;
      }

      const url = new URL(text);
      if (!url.hostname.includes("gktools.ris.moe")) {
        alert("gktools のURLではありません。");
        return;
      }

      const parsed = loadoutFromSearchParams(url.searchParams);
      if (parsed) {
        setLoadout(fixLoadout(parsed));  // ← wrap
      } else {
        alert("読み込み失敗：構成が不完全です");
      }
    } catch (err) {
      console.error("Clipboard error:", err);
      alert("クリップボードの読み込みに失敗しました。");
    }
  }

  function runSimulationWithWorkers(workers, config, strategy, numRuns) {
    if (!workers || workers.length === 0) {
      const result = simulate(config, strategy, numRuns);
      const avg = result.scores.reduce((sum, v) => sum + v, 0) / result.scores.length;
      return Promise.resolve({ result, avg });
    }

    const runsPerWorker = Math.round(numRuns / workers.length);

    const promises = workers.map(
      (worker) =>
        new Promise((resolve) => {
          worker.onmessage = (e) => resolve(e.data);
          worker.postMessage({
            idolStageConfig: config,
            strategyName: strategy,
            numRuns: runsPerWorker,
          });
        })
    );

    return Promise.all(promises).then((results) => {
      const allScores = results.flatMap((res) => res.scores);
      const avg = allScores.reduce((sum, v) => sum + v, 0) / allScores.length;
      return { result: results[0], avg };
    });
  }

  async function runSimulation() {
    setRunning(true);
    console.time("simulation");

    const numWorkers = workersRef.current?.length || 1;

    const runsPerWorker = Math.round(numRuns / numWorkers);
    const scored = [];

    if (explorationMode === "item") {
      const allCombos = generateItemCombos(loadout.pItemIds, itemCandidates);
      console.log("生成されたコンボ総数:", allCombos.length);

      const combos = allCombos.length <= 64 ? allCombos : allCombos.slice(0, 64);

      for (const combo of combos) {
        const newLoadout = { ...loadout, pItemIds: combo };
        const newConfig = new IdolStageConfig(
          new IdolConfig(newLoadout),
          new StageConfig(stage)
        );

        if (numWorkers > 1) {
          const promises = workersRef.current.map(
            (worker) =>
              new Promise((resolve) => {
                worker.onmessage = (e) => resolve(e.data);
                worker.postMessage({
                  idolStageConfig: newConfig,
                  strategyName: strategy,
                  numRuns: runsPerWorker,
                });
              })
          );

          const results = await Promise.all(promises);
          const scores = results.flatMap((res) => res.scores);
          const avg = scores.reduce((sum, v) => sum + v, 0) / scores.length;
          scored.push({ result: results[0], combo, avg });
        } else {
          const { result, avg } = await runSimulationWithWorkers(
            workersRef.current,
            newConfig,
            strategy,
            numRuns
          );
          scored.push({ result, combo, avg });
        }

        await new Promise((r) => setTimeout(r, 0));
      }
    } else if (explorationMode === "card") {
    // --- memorySets の存在チェックと修復処理 ---
    if (!loadout.memorySets || !Array.isArray(loadout.memorySets) || !loadout.memorySets[0]) {
      if (loadout.skillCardIdGroups?.[0]) {
        const fixed = fixLoadout(loadout);
        setLoadout(fixed);
        setRunning(false);
        setTimeout(() => runSimulation(), 0);
        return;
      } else {
        alert("カード探索を行うには memorySets が必要です。");
        setRunning(false);
        return;
      }
    }

    // --- ターゲットスロット設定 ---
    const selectedIndices = [2, 3, 4, 5].slice(-targetSlotCount);
    const targetSlots = [];

    for (let groupIndex = 0; groupIndex < loadout.memorySets.length; groupIndex++) {
      for (const slotIndex of selectedIndices) {
        targetSlots.push({ groupIndex, slotIndex });
      }
    }

    // --- 初期化 ---
    const seenLoadoutKeys = new Set();

    // --- 候補カードの整形 ---
    const candidateCards = [];
    for (let i = 0; i < cardCandidates.length; i++) {
      if (cardCandidates[i]) {
        candidateCards.push({
          cardId: cardCandidates[i],
          customization: cardCustomizationsList[i] || [],
        });
      }
    }

    const maxReplace = Math.min(candidateCards.length, targetSlots.length);

      // 元構成を常に含める（順序無視のキー）
      {
        const newLoadout = structuredClone(loadout);
        const sortedSets = newLoadout.memorySets.map((set, gi) => {
          const cardPairs = set.cards.map((cardId, si) => ({
            cardId,
            customization: newLoadout.customizationGroups[gi]?.[si] || {},
          }));
          return cardPairs
            .filter((p) => typeof p.cardId === "number")
            .sort((a, b) => a.cardId - b.cardId);
        });

        const originalKey = JSON.stringify({
          normalizedCardCustomizations: sortedSets,
          pItemIds: newLoadout.pItemIds,
        });

        if (!seenLoadoutKeys.has(originalKey)) {
          seenLoadoutKeys.add(originalKey);
          const newConfig = new IdolStageConfig(
            new IdolConfig(newLoadout),
            new StageConfig(stage)
          );
          const { result, avg } = await runSimulationWithWorkers(
            workersRef.current,
            newConfig,
            strategy,
            numRuns
          );

          scored.push({
            result: {
              ...result,
              loadout: newLoadout,
            },
            avg,
          });
        }
      }

      for (let k = 1; k <= maxReplace; k++) {
        const slotCombos = combinations(targetSlots, k);
        const cardPerms = permutations(candidateCards, k);

        for (const slots of slotCombos) {
          for (const cards of cardPerms) {
              const baseIds = new Set();
          let hasDuplicateUnique = false;

          for (const { cardId } of cards) {
            const card = SkillCards.getById(cardId);
            if (!card) continue;

            if (card.unique) {
              const baseId = getBaseId(card);
              if (baseIds.has(baseId)) {
                hasDuplicateUnique = true;
                break;
              }
              baseIds.add(baseId);
            }
          }

          if (hasDuplicateUnique) continue;
          if (hasDuplicateUniqueCardsAcrossLoadout(loadout, cards, slots)) continue;

            const newLoadout = structuredClone(loadout);

            if (!newLoadout.customizationGroups) newLoadout.customizationGroups = [];
            if (!newLoadout.memorySets) newLoadout.memorySets = [];

            for (let g = 0; g < 2; g++) {
              if (!newLoadout.memorySets[g]) newLoadout.memorySets[g] = { cards: [] };
              if (!Array.isArray(newLoadout.memorySets[g].cards)) {
                newLoadout.memorySets[g].cards = [];
              }
              for (let i = 0; i < 6; i++) {
                if (typeof newLoadout.memorySets[g].cards[i] !== "number") {
                  newLoadout.memorySets[g].cards[i] = loadout.memorySets?.[g]?.cards?.[i] ?? null;
                }
              }

              if (!newLoadout.customizationGroups[g]) newLoadout.customizationGroups[g] = [];
              for (let i = 0; i < 6; i++) {
                if (typeof newLoadout.customizationGroups[g][i] !== "object") {
                  newLoadout.customizationGroups[g][i] = structuredClone(
                    loadout.customizationGroups?.[g]?.[i] || {}
                  );
                }
              }
            }

            let skip = false;
            for (let i = 0; i < k; i++) {
              const { groupIndex, slotIndex } = slots[i];
              const { cardId, customization } = cards[i];

              // 差し替え対象を除いたカードと比較して重複を避ける
              const currentCards = [...newLoadout.memorySets[groupIndex].cards];
              for (let j = 0; j < k; j++) {
                const { groupIndex: gi, slotIndex: si } = slots[j];
                if (gi === groupIndex) currentCards[si] = null;
              }
              if (currentCards.includes(cardId)) {
                skip = true;
                break;
              }

              newLoadout.memorySets[groupIndex].cards[slotIndex] = cardId;
              newLoadout.customizationGroups[groupIndex][slotIndex] = customization;
            }

            if (skip) continue;

          const overLimit = newLoadout.customizationGroups.some((group, i) => {
            const originalCount = countCustomizations(loadout.customizationGroups?.[i] || []);
            return countCustomizations(group) > originalCount;
          });
          if (overLimit) continue;

            // 順序を無視したカスタマイズ構成による重複検出
            const sortedSets = newLoadout.memorySets.map((set, gi) => {
              const cardPairs = set.cards.map((cardId, si) => ({
                cardId,
                customization: newLoadout.customizationGroups[gi]?.[si] || {},
              }));
              return cardPairs
                .filter((p) => typeof p.cardId === "number")
                .sort((a, b) => a.cardId - b.cardId);
            });

            const key = JSON.stringify({
              normalizedCardCustomizations: sortedSets,
              pItemIds: newLoadout.pItemIds,
            });

            if (seenLoadoutKeys.has(key)) continue;
            seenLoadoutKeys.add(key);

            const newConfig = new IdolStageConfig(
              new IdolConfig(newLoadout),
              new StageConfig(stage)
            );

            const { result, avg } = await runSimulationWithWorkers(
              workersRef.current,
              newConfig,
              strategy,
              numRuns
            );
            scored.push({
              result: {
                ...result,
                loadout: newLoadout,
              },
              avg,
            });

            await new Promise((r) => setTimeout(r, 0));
          }
        }
      }
    }

    setComboPoints(new Map()); // 通常実行でポイントリセット
    setComboTrialCounts(new Map()); // 累計試行回数初期化（スコア・ポイントと一緒に）
    scored.sort((a, b) => b.avg - a.avg);
    setSimulatorData(scored[0]?.result || null);
    setTopCombos(scored.slice(0, 5));
    setInitialCombos(scored); // 元の候補群を保存
    setRunning(false);
    console.timeEnd("simulation");
    console.log(`カード探索で実行された構成数: ${scored.length}`);
  }

  async function runTopCombosAgain() {
    if (initialCombos.length === 0) {
      alert("前回の候補がありません。まず通常のシミュレーションを実行してください。");
      return;
    }

    setRunning(true);
    console.time("resimulation");

    const reevaluated = [];
    const seenKeys = new Set();

    const maxAvg = initialCombos[0].avg;
    const threshold = maxAvg * 0.9;
    const sorted = [...initialCombos].sort((a, b) => b.avg - a.avg);
    const requiredCount = Math.ceil(initialCombos.length * 0.1);

    const selectedCombos = sorted.filter(
      (entry) => entry.avg >= threshold && entry.result?.loadout
    );

    let i = 0;
    while (selectedCombos.length < requiredCount && i < sorted.length) {
      const next = sorted[i];
      i++;
      if (next?.result?.loadout && !selectedCombos.includes(next)) {
        selectedCombos.push(next);
      }
    }

    for (let setIndex = 0; setIndex < retrySetCount; setIndex++) {
      const currentSet = [];

      for (let index = 0; index < selectedCombos.length; index++) {
        const entry = selectedCombos[index];
        const newLoadout = entry.result?.loadout || loadout;
        const newConfig = new IdolStageConfig(
          new IdolConfig(newLoadout),
          new StageConfig(stage)
        );

        const { result } = await runSimulationWithWorkers(
          workersRef.current,
          newConfig,
          strategy,
          numRuns
        );

        const scores = result?.scores || [];
        const avg = scores.length
          ? scores.reduce((sum, v) => sum + v, 0) / scores.length
          : 0;

        const key = getLoadoutKey(newLoadout);
        seenKeys.add(key);

        const item = {
          result: { ...result, loadout: newLoadout },
          avg,
          key,
        };

        reevaluated.push(item);
        currentSet.push(item);

        // 累計試行回数を加算（即時でOK）
        setComboTrialCounts((prev) => {
          const updated = new Map(prev);
          updated.set(key, (updated.get(key) || 0) + numRuns);
          return updated;
        });

        await new Promise((r) => setTimeout(r, 0));
      }

      // セット単位でポイント加算（スコア順に並べ替えて順位に応じて加点）
      currentSet.sort((a, b) => b.avg - a.avg);
      setComboPoints((prev) => {
        const updated = new Map(prev);
        currentSet.forEach((entry, index) => {
          const points = Math.max(0, 20 - index);
          updated.set(entry.key, (updated.get(entry.key) || 0) + points);
        });
        return updated;
      });
    }

    // 最終並び替えと表示
    reevaluated.sort((a, b) => b.avg - a.avg);
    const top5 = reevaluated.slice(0, 5);
    setSimulatorData(reevaluated[0]?.result || null);
    setTopCombos(top5);

    setRunning(false);
    console.timeEnd("resimulation");
    console.log(`カード探索で実行された構成数: ${reevaluated.length}`);
  }

  function saveCurrentLoadout() {
    const saved = {
      loadout: {
        ...loadout,
        skillCardIdGroups: loadout.skillCardIdGroups || [],
        customizationGroups: loadout.customizationGroups || [],
      },
      itemCandidates,
    };
    localStorage.setItem("deckExplorerSavedLoadout", JSON.stringify(saved));
  }

  function loadSavedLoadout() {
    const data = localStorage.getItem("deckExplorerSavedLoadout");
    if (!data) return alert("保存されたデッキが見つかりません。");

    try {
      const saved = JSON.parse(data);
      setLoadout(fixLoadout(saved.loadout));  // ← wrap
      if (saved.itemCandidates) {
        setItemCandidates(saved.itemCandidates);
      }
    } catch (err) {
      console.error("Load error:", err);
      alert("読み込みに失敗しました。");
    }
  }

  return (
    <div className={styles.loadoutEditor}>
      <div className={styles.configurator}>
        <StageSelect />

        {stage.type === "event" ? (
          t("enterPercents")
        ) : (
          <div className={styles.supportBonusInput}>
            <label>{t("supportBonus")}</label>
            <Input
              type="number"
              value={parseFloat(((loadout.supportBonus || 0) * 100).toFixed(2))}
              onChange={(value) =>
                setSupportBonus(parseFloat((value / 100).toFixed(4)))
              }
            />
          </div>
        )}

        <div className={styles.params}>
          <ParametersInput
            parameters={loadout.params}
            onChange={setParams}
            withStamina
            max={10000}
          />
          <div className={styles.typeMultipliers}>
            {Object.keys(config.typeMultipliers).map((param) => (
              <div key={param}>
                {Math.round(config.typeMultipliers[param] * 100)}%
              </div>
            ))}
            <div />
          </div>
        </div>

        <div className={styles.pItemsRow}>
          <div className={styles.pItems}>
            <StagePItems
              pItemIds={loadout.pItemIds}
              replacePItemId={replacePItemId}
              indications={pItemIndications}
              size="medium"
            />
          </div>
          <span>{formatStageShortName(stage, t)}</span>
        </div>

        <div>
        <div>
          <span>
          <h4>アイテム候補</h4>
          <StagePItems
            pItemIds={itemCandidates}
            replacePItemId={replaceItemCandidate}
            indications={[]}
            size="small"
          />

          <h4>カード候補</h4>
          <StageSkillCards
            skillCardIds={cardCandidates}
            customizations={cardCustomizationsList}
            replaceSkillCardId={replaceCardSwapCandidate}
            replaceCustomizations={replaceCardCustomizations}
            size="small"
            groupIndex={0}
          />
          </span>
        </div>
      </div>

        {loadout.skillCardIdGroups.map((skillCardIdGroup, i) => (
          <LoadoutSkillCardGroup
            key={i}
            skillCardIds={skillCardIdGroup}
            customizations={loadout.customizationGroups[i]}
            indications={skillCardIndicationGroups[i]}
            groupIndex={i}
            idolId={config.idol.idolId || idolId}
          />
        ))}

        <DeckExplorerSubTools defaultCardIds={config.defaultCardIds} />

        <select
          className={styles.strategySelect}
          value={strategy}
          onChange={(e) => setStrategy(e.target.value)}
        >
          {Object.keys(STRATEGIES).map((strategy) => (
            <option key={strategy} value={strategy}>
              {strategy}
            </option>
          ))}
        </select>

        <details>
          <summary style={{ cursor: "pointer", fontWeight: "bold" }}>
            ◆各モードの使い方（クリックで展開）◆
          </summary>
          <div className={styles.modeSection}>
            <details>
              <summary>画面の説明</summary>
              <div>
                <img src="/deckexplorer/00.png" alt="画面の説明①" />
                <img src="/deckexplorer/01.png" alt="画面の説明②" />
                <p>① アイテム候補：検証したいアイテムをセットするスロット。</p>
                <p>② カード候補：検証したいカードをセットするスロット。</p>
                <p>③ 探索モード：「アイテム」と「カード」の2種の探索モードを設定。</p>
                <p>④ 試行回数：シミュの回転数の設定。各組み合わせに対して適用される。</p>
                <p>⑤ 再試行セット数：再試行をセットで回す回数を設定。</p>
                <p>⑥ 差替えスロット数：メモリー1枚あたりの差替えカード数を設定。</p>
                <p>⑦ ポイント順で表示：カード探索モードの結果表示をポイント順でソート。</p>
              </div>
            </details>

            <details style={{ marginTop: "1em" }}>
              <summary>アイテム探索モード</summary>
              <div>
                <p>設定したデッキの最適アイテムを探索するモード。</p>
                <p>① デッキを組む（risシミュと同様）。</p>
                <p>② アイテム候補にアイテムをセット。</p>
                <p>③ 探索モードを「アイテム」に設定。試行回数も任意の数に設定。</p>
                <p>④ 「実行」ボタンを押下。</p>
                <p>⑤ スコア（平均）が高い順に最大5組の結果が表示される。</p>
                <img src="/deckexplorer/02.png" alt="アイテム探索の結果" />
              </div>
            </details>

            <details style={{ marginTop: "1em" }}>
              <summary>カード探索モード</summary>
              <div>
                <p>最適デッキを探索するモード。</p>
                <p>① デッキを組む（risシミュと同様）。</p>
                <p>② カード候補にカスタム等を含めたカードをセット。</p>
                <p>③ 探索モードを「カード」に設定。試行回数も任意の数に設定。</p>
                <p>※差替えスロットは右から数える（左から1・2スロット目はアイドル固有とサポカを考慮し差替え対象外。1・2スロット目にカスタムされた通常カードを設定する場合はカスタム数に注意）。</p>
                <p>④ 「実行」ボタンを押下。</p>
                <p>⑤ スコア（平均）が高い順に最大5組の結果が表示される。</p>
                <p>⑥ 「上位10％を再試行」ボタンを押下。実行するたびに各組み合わせに対しポイントが加算される。この時「再試行セット数」を設定すると指定したセット数で実行する。</p>
                <p>※ポイントについて：スコアが高く出やすい組み合わせを評価するための指標。ポイントが高いほどスコアがでやすい組み合わせ。</p>
                <p>⑦ 「ポイント順」にチェックを入れて、ポイントの高い組み合わせを確認する。「risシミュ」をクリックするとその組み合わせでrisシミュに遷移する。納得する結果が得られたら終了。</p>
                <p className={styles.warning}>
                  ・カード候補／試行回数／再試行セット数／差替えスロット数を増加させると重くなるので、④実行時は試行回数を200程度に制限推奨。<br />
                  ・カスタム数はセットされたデッキの各メモリーセット毎に合わせて自動的に設定される。<br />
                  ・ポイントは再度「実行」ボタンを押下したタイミングでリセットされる。
                </p>
                <img src="/deckexplorer/04.png" alt="カード探索の結果" />
              </div>
            </details>
          </div>
        </details>

        <div className={styles.supportBonusInput}>
          <label htmlFor="mode">探索モード</label>
          <select
            id="mode"
            value={explorationMode}
            onChange={(e) => setExplorationMode(e.target.value)}
            style={{ padding: "4px" }}
          >
            <option value="item">アイテム</option>
            <option value="card">カード</option>
          </select>
        </div>

        <div className={styles.supportBonusInput}>
          <label htmlFor="numRuns">試行回数</label>
          <select
            id="numRuns"
            value={numRuns}
            onChange={(e) => setNumRuns(Number(e.target.value))}
            style={{ padding: "4px" }}
          >
            {[20, 50, 100, 200, 400, 1000, 2000].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.supportBonusInput}>
          <label>再試行セット数</label>
          <select
            value={retrySetCount}
            onChange={(e) => setRetrySetCount(Number(e.target.value))}
            style={{ padding: "4px" }}
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.supportBonusInput}>
          <label htmlFor="targetSlotCount">差替えスロット数</label>
          <select
            id="targetSlotCount"
            value={targetSlotCount}
            onChange={(e) => setTargetSlotCount(Number(e.target.value))}
            style={{ padding: "4px" }}
          >
            {[2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <Button style="blue" onClick={runSimulation} disabled={running}>
          {running ? <Loader /> : t("simulate")}
        </Button>

        <Button
          style="blue"
          onClick={runTopCombosAgain}
          disabled={explorationMode === "item" || running}
        >
          {running
            ? <Loader />
            : explorationMode === "item"
              ? "（カード探索専用）"
              : "上位10％を再試行"}
        </Button>

        <label style={{ display: "inline-flex", alignItems: "center", gap: "4px", marginTop: "8px" }}>
          <input
            type="checkbox"
            checked={sortByPoints}
            onChange={(e) => setSortByPoints(e.target.checked)}
          />
          ポイント順に表示
        </label>

        <div style={{ textAlign: "right", marginTop: "4px" }}>
          <a
            href="https://www.fanbox.cc/@kokorohappy"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: "12px", color: "#888", textDecoration: "none" }}
          >
            FANBOXで労わる ☕
          </a>
        </div>

        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <Button style="gray" onClick={saveCurrentLoadout}>
            一時保存
          </Button>
          <Button style="gray" onClick={loadSavedLoadout}>
            一時読込
          </Button>
          <Button
            style="gray"
            onClick={() => {
              navigator.clipboard.writeText(deckExplorerUrl);
            }}
          >
            そろあじURL
          </Button>

          <Button asChild style="gray">
            <a href={simulatorUrl} target="_blank" rel="noopener noreferrer">
              risシミュへ遷移
            </a>
          </Button>
        </div>
        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <Button style="gray" onClick={readFromClipboardAndParse}>
            risシミュURLから読み込み
          </Button>
        </div>

        {topCombos.length > 0 && (
          <div className={styles.results}>
            {/* アイテム候補の上位 */}
            {explorationMode === "item" && (
              <>
                <h4>アイテム候補の上位</h4>
                <div className={styles.comboRow}>
                  {topCombos
                    .filter((entry) => entry.combo)
                    .map((entry, idx) => (
                      <div key={`item-${idx}`} className={styles.comboGroup}>
                        <div className={styles.comboIcons}>
                          {entry.combo.slice(1).map((id, i) => (
                            <EntityIcon
                              key={i}
                              type={EntityTypes.P_ITEM}
                              id={id}
                              style="medium"
                            />
                          ))}
                        </div>
                        <div className={styles.comboScore}>
                          スコア: {Math.round(entry.avg)}
                        </div>
                      </div>
                    ))}
                </div>
              </>
            )}

            {/* カード候補の上位 */}
            {explorationMode === "card" && (
              <>
                <h4>カード候補の上位</h4>
                
                <div className={styles.comboRow}>
                  {displayCombos.map((entry, idx) => {
                    const loadout = entry.result?.loadout;
                    const memorySets = loadout?.memorySets || [];
                    const customizationGroups = loadout?.customizationGroups || [];
                    const key = getLoadoutKey(loadout);

                    return (
                      <div key={`card-${idx}`} className={styles.comboGroup}>
                        {memorySets.map((cardGroup, groupIndex) => (
                          <div key={`group-${groupIndex}`} style={{ display: "flex", gap: "4px", marginBottom: "4px" }}>
                            {cardGroup.cards.map((cardId, slotIndex) => {
                              const customization = customizationGroups?.[groupIndex]?.[slotIndex] || [];
                              return (
                                <EntityIcon
                                  key={slotIndex}
                                  type={EntityTypes.SKILL_CARD}
                                  id={cardId}
                                  style="medium"
                                  customizations={customization}
                                />
                              );
                            })}
                          </div>
                        ))}
                        <div className={styles.comboScore}>
                          {(() => {
                            const key = getLoadoutKey(entry.result.loadout);
                            const point = comboPoints.get(key) || 0;
                            const trials = comboTrialCounts.get(key) || numRuns;
                            const loadout = entry.result?.loadout;
                            const url = loadout && typeof loadout === "object" && loadout.stageId != null
                              ? getSimulatorUrl(loadout)
                              : "";

                            return (
                              <>
                                {/* 各行に全角スペースあり */}
                                スコア: {Math.round(entry.avg)}　
                                ポイント: {point}　
                                累計試行回数: {trials}　
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={styles.simulatorLink}
                                >
                                  risシミュ
                                </a>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
