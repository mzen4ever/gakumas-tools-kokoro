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
  const [cardCandidates, setCardCandidates] = useState([null]);
  const [cardCustomizationsList, setCardCustomizationsList] = useState([]);
  const [explorationMode, setExplorationMode] = useState("item");
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
          const result = simulate(newConfig, strategy, numRuns);
          const avg = result.scores.reduce((sum, v) => sum + v, 0) / result.scores.length;
          scored.push({ result, combo, avg });
        }

        await new Promise((r) => setTimeout(r, 0));
      }
    } else if (explorationMode === "card") {
      const targetSlot = 5;

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

      const originalCardId = loadout.memorySets[0].cards?.[targetSlot];
      const originalCustomization =
        loadout.customizationGroups?.[0]?.[targetSlot] || [];

      console.log("=== カード探索モード実行 ===");
      console.log("現在スロット5のカード:", originalCardId);
      console.log("cardCandidates state:", cardCandidates);

      // 現在のカード + 候補カード
      const allCandidates = [{ cardId: originalCardId, customization: originalCustomization }];
      for (let i = 0; i < cardCandidates.length; i++) {
        const cardId = cardCandidates[i];
        if (!cardId) continue;
        const customization = cardCustomizationsList[i] || [];
        allCandidates.push({ cardId, customization });
      }

      console.log("候補カード一覧（スロット5に差替）:", allCandidates);

      for (const { cardId, customization } of allCandidates) {
        const newLoadout = structuredClone(loadout);
        if (!newLoadout.memorySets?.[0]?.cards) continue;

        newLoadout.memorySets[0].cards[targetSlot] = cardId;

        if (!newLoadout.customizationGroups) newLoadout.customizationGroups = [];
        if (!newLoadout.customizationGroups[0]) newLoadout.customizationGroups[0] = [];
        newLoadout.customizationGroups[0][targetSlot] = customization;

        console.log("=== シミュレーション候補 ===");
        console.log("候補カードID:", cardId);
        console.log("カスタマイズ:", customization);
        console.log("newLoadout.memorySets[0].cards:", newLoadout.memorySets[0].cards);

        const newConfig = new IdolStageConfig(
          new IdolConfig(newLoadout),
          new StageConfig(stage)
        );

        const result = simulate(newConfig, strategy, numRuns);
        const avg = result.scores.reduce((sum, v) => sum + v, 0) / result.scores.length;

        scored.push({
          result: {
            ...result,
            loadout: newLoadout,
          },
          avg,
        });

        await new Promise((r) => setTimeout(r, 0));
      }
    } else if (explorationMode === "both") {
        const targetSlot = 5;

        if (!loadout.memorySets || !loadout.memorySets[0]) {
          if (loadout.skillCardIdGroups?.[0]) {
            const fixed = fixLoadout(loadout);
            setLoadout(fixed);
            setRunning(false);
            setTimeout(() => runSimulation(), 0);
            return;
          } else {
            alert("両方探索を行うには memorySets[0] が必要です。");
            setRunning(false);
            return;
          }
        }

        const originalCardId = loadout.memorySets[0].cards?.[targetSlot];
        const originalCustomization =
          loadout.customizationGroups?.[0]?.[targetSlot] || [];

        // ✅ カード＋カスタマイズで全候補をリスト化
        const allCandidates = [
          { cardId: originalCardId, customization: originalCustomization },
        ];

        for (let i = 0; i < cardCandidates.length; i++) {
          const cardId = cardCandidates[i];
          if (!cardId) continue;
          const customization = cardCustomizationsList[i] || [];
          allCandidates.push({ cardId, customization });
        }

        console.log("=== 両方探索モード実行 ===");
        console.log("カード候補:", allCandidates);
        console.log("アイテム候補数:", itemCandidates.length);

        for (const { cardId, customization } of allCandidates) {
          const newLoadoutBase = structuredClone(loadout);
          newLoadoutBase.memorySets[0].cards[targetSlot] = cardId;

          if (!newLoadoutBase.customizationGroups)
            newLoadoutBase.customizationGroups = [];
          if (!newLoadoutBase.customizationGroups[0])
            newLoadoutBase.customizationGroups[0] = [];

          newLoadoutBase.customizationGroups[0][targetSlot] = customization;

          const itemCombos = generateItemCombos(
            loadout.pItemIds,
            itemCandidates
          );
          const combos =
            itemCombos.length <= 64 ? itemCombos : itemCombos.slice(0, 64);

          for (const itemCombo of combos) {
            const newLoadout = structuredClone(newLoadoutBase);
            newLoadout.pItemIds = itemCombo;

            const newConfig = new IdolStageConfig(
              new IdolConfig(newLoadout),
              new StageConfig(stage)
            );

            const result = simulate(newConfig, strategy, numRuns);
            const avg =
              result.scores.reduce((sum, v) => sum + v, 0) /
              result.scores.length;

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

    scored.sort((a, b) => b.avg - a.avg);
    setSimulatorData(scored[0]?.result || null);
    setTopCombos(scored.slice(0, 5));
    setRunning(false);
    console.timeEnd("simulation");
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

        <div className={styles.candidateRow}>
  <div>
      <h4>アイテム候補（最大3つ）</h4>
      <StagePItems
        pItemIds={itemCandidates}
        replacePItemId={replaceItemCandidate}
        indications={[]}
        size="small"
      />
    </div>

    <div>
      <h4>カード候補</h4>
      <StageSkillCards
        skillCardIds={cardCandidates}
        customizations={cardCustomizationsList}
        replaceSkillCardId={replaceCardSwapCandidate}
        replaceCustomizations={replaceCardCustomizations}
        size="small"
        groupIndex={0}
      />
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

        <div className={styles.supportBonusInput}>
          <label>探索モード</label>
          <select
            value={explorationMode}
            onChange={(e) => setExplorationMode(e.target.value)}
            style={{ padding: "4px" }}
          >
            <option value="item">アイテム</option>
            <option value="card">カード</option>
            <option value="both">両方</option>
          </select>
        </div>

        <Button style="blue" onClick={runSimulation} disabled={running}>
          {running ? <Loader /> : t("simulate")}
        </Button>

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

          <Button
            style="gray"
            onClick={() => {
              navigator.clipboard.writeText(simulatorUrl);
            }}
          >
            risシミュURL
          </Button>
        </div>
        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <Button style="gray" onClick={readFromClipboardAndParse}>
            risシミュURLから読み込み
          </Button>
        </div>
          
        <div className={styles.url}>{simulatorUrl}</div>

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
                  {topCombos
                    .filter((entry) => entry.result?.loadout?.memorySets?.[0]?.cards?.[5] != null)
                    .map((entry, idx) => {
                      const cardId = entry.result.loadout.memorySets[0].cards[5];
                      const customization = entry.result.loadout.customizationGroups?.[0]?.[5] || [];

                      return (
                        <div key={`card-${idx}`} className={styles.comboGroup}>
                          <div className={styles.comboIcons}>
                            <EntityIcon
                              type={EntityTypes.SKILL_CARD}
                              id={cardId}
                              style="medium"
                              customizations={customization}
                            />
                          </div>
                          <div className={styles.comboScore}>
                            スコア: {Math.round(entry.avg)}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </>
            )}

            {/* 両方候補の上位 */}
            {explorationMode === "both" && (
              <>
                <h4>両方候補の上位</h4>
                <div className={styles.comboRow}>
                  {topCombos
                    .filter(
                      (entry) =>
                        entry?.result?.loadout?.memorySets?.[0]?.cards?.[5] != null &&
                        Array.isArray(entry?.result?.loadout?.pItemIds) &&
                        entry.result.loadout.pItemIds.length >= 2
                    )
                    .map((entry, idx) => {
                      const loadout = entry.result.loadout;
                      const cardId = loadout.memorySets[0].cards[5];
                      const customization = loadout.customizationGroups?.[0]?.[5] || [];
                      const itemIds = loadout.pItemIds.slice(1); // slot 1 and 2

                      return (
                        <div key={`both-${idx}`} className={styles.comboGroup}>
                          <div className={styles.comboIcons}>
                            <EntityIcon
                              type={EntityTypes.SKILL_CARD}
                              id={cardId}
                              style="medium"
                              customizations={customization}
                            />
                            {itemIds.map((id, i) =>
                              id ? (
                                <EntityIcon
                                  key={`item-${i}`}
                                  type={EntityTypes.P_ITEM}
                                  id={id}
                                  style="medium"
                                />
                              ) : null
                            )}
                          </div>
                          <div className={styles.comboScore}>
                            スコア: {Math.round(entry.avg)}
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
