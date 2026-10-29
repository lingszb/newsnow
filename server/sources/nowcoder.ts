interface Res {
  data: {
    result: {
      id: string
      title: string
      type: number
      uuid: string
    }[]
  }
}

export default defineSource(async () => {
  const timestamp = Date.now()
  const url = `https://gw-c.nowcoder.com/api/sparta/hot-search/top-hot-pc?size=20&_=${timestamp}&t=`
  const res: Res = await myFetch(url)
  return res.data.result.flatMap((item) => {
    if (item.type === 74)
      return [{ id: item.uuid, title: item.title, url: `https://www.nowcoder.com/feed/main/detail/${item.uuid}` }]
    if (item.type === 0)
      return [{ id: item.id, title: item.title, url: `https://www.nowcoder.com/discuss/${item.id}` }]
    return []
  })
})
