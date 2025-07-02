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

  const deckExplorerUrl = useMemo(() => getDeckExplorerUrl(loadout), [loadout]);
  const simulatorUrl = useMemo(() => getSimulatorUrl(loadout), [loadout]);

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
      // メモリーセット確認
      if (!loadout.memorySets || !Array.isArray(loadout.memorySets)) {
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
      // ターゲットスロット設定
      const targetSlots = [];
      const selectedIndices = [2, 3, 4, 5].slice(-targetSlotCount);

      for (let groupIndex = 0; groupIndex < loadout.memorySets.length; groupIndex++) {
        for (const slotIndex of selectedIndices) {
          targetSlots.push({ groupIndex, slotIndex });
        }
      }

      const seenLoadoutKeys = new Set();

      if (!loadout.memorySets || !loadout.memorySets[0]) {
        if (loadout.skillCardIdGroups?.[0]) {
          const fixed = fixLoadout(loadout);
          setLoadout(fixed);
          setRunning(false);
          setTimeout(() => runSimulation(), 0);
          return;
        } else {
          alert("カード探索を行うには memorySets[0] が必要です。");
          setRunning(false);
          return;
        }
      }

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

            const overLimit = newLoadout.customizationGroups.some((group) => {
              return countCustomizations(group) > customizationLimit;
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

    // 上位スコアから再試行対象を選出（最低10%を含める）
    const maxAvg = initialCombos[0].avg;
    const threshold = maxAvg * 0.9;
    const sorted = [...initialCombos].sort((a, b) => b.avg - a.avg);
    const requiredCount = Math.ceil(initialCombos.length * 0.1);

    // 有効な loadout を持つものだけ対象にする
    const selectedCombos = sorted.filter(
      (entry) => entry.avg >= threshold && entry.result?.loadout
    );

    // 不足分をスコア順で追加（安全な loadout を持つものだけ）
    let i = 0;
    while (selectedCombos.length < requiredCount && i < sorted.length) {
      const next = sorted[i];
      i++;
      if (
        next?.result?.loadout &&
        !selectedCombos.includes(next)
      ) {
        selectedCombos.push(next);
      }
    }

    for (const entry of selectedCombos) {
      const newLoadout = entry.result?.loadout || loadout;
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

      reevaluated.push({ result: { ...result, loadout: newLoadout }, avg });
      await new Promise((r) => setTimeout(r, 0));
    }

    // 組み合わせにポイント加算
    setComboPoints((prev) => {
      const updated = new Map(prev);
      reevaluated.forEach((entry, index) => {
        const key = getLoadoutKey(entry.result.loadout);
        const points = Math.max(0, 20 - index);
        updated.set(key, (updated.get(key) || 0) + points);
      });
      return updated;
    });

    // 累計試行回数加算
    setComboTrialCounts((prev) => {
      const updated = new Map(prev);
      reevaluated.forEach((entry) => {
        const key = getLoadoutKey(entry.result.loadout);
        updated.set(key, (updated.get(key) || 0) + numRuns);
      });
      return updated;
    });

    reevaluated.sort((a, b) => b.avg - a.avg);
    const top5 = reevaluated.slice(0, 5);
    setSimulatorData(reevaluated[0]?.result || null);
    setTopCombos(top5); // 上位5件のみ表示
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
            ◆探索モードの仕様（クリックで展開）◆
          </summary>
          <div style={{ paddingLeft: "1em", marginTop: "0.5em" }}>
            <p>カード候補に登録したカードは、指定されたスロットに差し替え候補として使用されます。</p>
            <ul>
              <li>差し替え対象スロットはメモリーセット1・2のスロット5・6です。</li>
              <li>カード候補は複数指定可能で、カスタマイズも反映されます。</li>
              <li>1スロットのみの差し替えに加え、複数スロットを同時に差し替える組み合わせも自動的に探索されます。</li>
              <li><u>カスタマイズ最大数（1セットあたり）を超える構成は除外されます。</u></li>
            </ul>
            <p><u>メモリーセットの1・2スロット目は固定されています。どちらかにアイドル固有カード、もしくはサポカを設定してください（ここにセットしたカードはカスタマイズ数の計算から除外されます）。</u></p>
            <p>スコアが高かった構成が「カード候補の上位」として表示されます。</p>
            <p style={{ color: "red", fontWeight: "bold", marginTop: "1em" }}>
              ※ 試行回数を増やすと非常に重くなります。200設定のまま何回か回して傾向を掴む使い方をおすすめします。
            </p>
          </div>
        </details>

        <div className={styles.supportBonusInput}>
          <label>探索モード</label>
          <select
            value={explorationMode}
            onChange={(e) => setExplorationMode(e.target.value)}
            style={{ padding: "4px" }}
          >
            <option value="item">アイテム</option>
            <option value="card">カード</option>
          </select>
        </div>
        
        <div className={styles.supportBonusInput}>
          <label>試行回数</label>
            <select
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
          <label>カスタマイズ最大数（1セットあたり）</label>
          <select
            value={customizationLimit}
            onChange={(e) => setCustomizationLimit(Number(e.target.value))}
            style={{ padding: "4px" }}
          >
            {[1, 2].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.supportBonusInput}>
          <label>差し替えスロット数</label>
          <select
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
            ローカル保存
          </Button>
          <Button style="gray" onClick={loadSavedLoadout}>
            ローカル読込
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

                            return (
                              <>
                                スコア: {Math.round(entry.avg)}　
                                ポイント: {point}　
                                累計試行回数: {trials}
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
