"use client";
import {
  useCallback,
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
import StageSelect from "@/components/StageSelect";
import EntityIcon from "@/components/EntityIcon";

import LoadoutContext from "@/contexts/LoadoutContext";
import WorkspaceContext from "@/contexts/WorkspaceContext";

import { simulate } from "@/simulator";
import { MAX_WORKERS } from "@/simulator/constants";
import {
  bucketScores,
  getMedianScore,
  getIndications,
} from "@/utils/simulator";
import { formatStageShortName } from "@/utils/stages";
import { EntityTypes } from "@/utils/entities";

import DeckExplorerSubTools from "@/components/DeckExplorer/DeckExplorerSubTools";
import styles from "@/components/DeckExplorer/DeckExplorer.module.scss";

const DEFAULT_NUM_RUNS = 200;

function generateItemCombos(currentItems, candidates) {
  const fixed = currentItems.find((id) => id != null);  // null or undefined を排除
  const usedSlotCount = currentItems.filter((id) => id != null).length;
  const usable = Array.from(
    new Set(
      [...currentItems.filter((id) => id != null && id !== fixed), ...candidates].filter(
        (id) => id != null
      )
    )
  );
  const results = [];
  for (let count = 0; count <= Math.min(usable.length, usedSlotCount - 1); count++) {
    const pick = (current, start = 0) => {
      if (current.length === count) {
        results.push([fixed, ...current]);
        return;
      }
      for (let i = start; i < usable.length; i++) {
        pick([...current, usable[i]], i + 1);
      }
    };
    pick([]);
  }
  return results;
}

export default function DeckExplorer() {
  const t = useTranslations("Simulator");
  const {
    stage,
    loadout,
    simulatorUrl,
    setSupportBonus,
    setParams,
    replacePItemId,
    setLoadout,
  } = useContext(LoadoutContext);
  const { idolId } = useContext(WorkspaceContext);

  const [strategy, setStrategy] = useState("HeuristicStrategy");
  const [simulatorData, setSimulatorData] = useState(null);
  const [itemCandidates, setItemCandidates] = useState([null, null, null]);
  const [running, setRunning] = useState(false);
  const [topCombos, setTopCombos] = useState([]);
  const [savedLoadout, setSavedLoadout] = useState(null);
  const [numRuns, setNumRuns] = useState(DEFAULT_NUM_RUNS);
  const workersRef = useRef();

  const config = useMemo(() => {
    const idolConfig = new IdolConfig(loadout);
    const stageConfig = new StageConfig(stage);
    return new IdolStageConfig(idolConfig, stageConfig);
  }, [loadout, stage]);

  const { pItemIndications, skillCardIndicationGroups } = getIndications(
    config,
    loadout
  );

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

  function replaceItemCandidate(index, id) {
    const updated = [...itemCandidates];
    updated[index] = id;
    setItemCandidates(updated);
  }

  async function runSimulation() {
    setRunning(true);
    console.time("simulation");

    const allCombos = generateItemCombos(loadout.pItemIds, itemCandidates);
    const combos = allCombos.length <= 64 ? allCombos : allCombos.slice(0, 64);
    const scored = [];
    const numWorkers = workersRef.current?.length || 1;
    const runsPerWorker = Math.round(numRuns / numWorkers);

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

    scored.sort((a, b) => b.avg - a.avg);
    setSimulatorData(scored[0].result);
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
    alert("ローカルに保存しました。");
  }

  function loadSavedLoadout() {
    const data = localStorage.getItem("deckExplorerSavedLoadout");
    if (!data) return alert("保存されたデッキが見つかりません。");

    try {
      const saved = JSON.parse(data);
      setLoadout(saved.loadout);
      if (saved.itemCandidates) {
        setItemCandidates(saved.itemCandidates);
      }
      alert("デッキを復元しました。");
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

        <div className={styles.supportBonusInput}>
          <label>試行回数（最大2000）</label>
          <Input
            type="number"
            value={numRuns}
            onChange={(value) =>
              setNumRuns(Math.min(2000, Math.max(1, parseInt(value) || 1)))
            }
          />
        </div>

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

        <h4>アイテム候補（最大3つ）</h4>
        <StagePItems
          pItemIds={itemCandidates}
          replacePItemId={replaceItemCandidate}
          indications={[]}
          size="small"
        />

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

        <Button style="blue" onClick={runSimulation} disabled={running}>
          {running ? <Loader /> : t("simulate")}
        </Button>

        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <Button style="gray" onClick={saveCurrentLoadout}>保存</Button>
          <Button style="gray" onClick={loadSavedLoadout}>読込</Button>
        </div>

        <div className={styles.url}>{simulatorUrl}</div>

        {topCombos.length > 0 && (
          <div className={styles.results}>
            <h4>上位5つ組み合わせ</h4>
            <div className={styles.comboRow}>
              {topCombos.map((entry, idx) => (
                <div key={idx} className={styles.comboGroup}>
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
          </div>
        )}
      </div>
    </div>
  );
}
