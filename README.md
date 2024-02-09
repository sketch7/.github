# workflows

## Tags

| Tag            | Description                                  |
| -------------- | -------------------------------------------- |
| dotnet-libs-v1 | .NET libs                                    |
| node-libs-v1   | node e.g. libs for node/lerna/cli/ngx etc... |


```bash
# move tag
git tag -f v1 {new commit hash} (or use ui for this)
git push origin v1 -f
# shorthand
TAG=<TAG> && git tag -f $TAG && git push origin $TAG -f
```