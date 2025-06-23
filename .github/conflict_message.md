自動マージ中に `upstream/master` とのコンフリクトが発生しました！

手動で以下の手順を実行して解消してください：

```bash
git fetch upstream
git merge upstream/master
# コンフリクトを解消
git commit
git push origin master
```

対象 upstream: https://github.com/surisuririsu/gakumas-tools
