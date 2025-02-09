/**
 * 推荐内容, 无限滚动
 */

import { APP_NAME, baseDebug } from '$common'
import { useModalDislikeVisible } from '$components/ModalDislike'
import { VideoCard, VideoCardActions } from '$components/VideoCard'
import { AppRecItemExtend, PcRecItemExtend } from '$define'
import { cssCls, cx } from '$libs'
import { HEADER_HEIGHT, getIsInternalTesting } from '$platform'
import { getRecommendForGrid, getRecommendTimes, uniqConcat } from '$service'
import { useSettingsSnapshot } from '$settings'
import { useMemoizedFn, useMount } from 'ahooks'
import { RefObject, forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import InfiniteScroll from 'react-infinite-scroller'
import { internalTesting, narrowMode, videoGrid } from '../video-grid.module.less'
import { getColumnCount, useShortcut } from './useShortcut'

const debug = baseDebug.extend('components:RecGrid')

export const cls = {
  loader: cssCls`
    text-align: center;
    line-height: 60px;
    font-size: 120%;
  `,

  card: cssCls`
    border: 2px solid transparent;

    /* global class under .card */
    .bili-video-card__info {
      padding-left: 2px;
      padding-bottom: 1px;
      margin-top: calc(var(--info-margin-top) - 1px);
    }
  `,
  cardActive: cssCls`
    border-color: #fb7299;
    border-radius: 6px;
    overflow: hidden;
  `,
}

export type RecGridRef = {
  refresh: () => void | Promise<void>
}

export type RecGridProps = {
  shortcutEnabled: boolean
  infiteScrollUseWindow: boolean
  onScrollToTop?: () => void | Promise<void>
  className?: string
  scrollerRef?: RefObject<HTMLElement | null>
}

export const RecGrid = forwardRef<RecGridRef, RecGridProps>(
  ({ infiteScrollUseWindow, shortcutEnabled, onScrollToTop, className, scrollerRef }, ref) => {
    const [items, setItems] = useState<(PcRecItemExtend | AppRecItemExtend)[]>([])
    const [isRefreshing, setIsRefreshing] = useState(false)

    const pageRef = useMemo(() => ({ page: 1 }), [])

    const refresh = useMemoizedFn(async () => {
      debug('call refresh()')

      // scroll to top
      await onScrollToTop?.()

      try {
        const start = performance.now()
        clearActiveIndex() // before
        setIsRefreshing(true)
        setItems([])
        pageRef.page = 1
        setItems(await getRecommendForGrid(pageRef))
        clearActiveIndex() // and after
        const cost = performance.now() - start
        if (process.env.NODE_ENV === 'development') {
          console.log(`[${APP_NAME}]: refresh cost %s ms`, cost.toFixed(0))
        }
      } finally {
        setIsRefreshing(false)
      }
    })

    useImperativeHandle(ref, () => ({ refresh }), [])
    useMount(refresh)

    const fetchMore = useMemoizedFn(async () => {
      debug('call fetchMore: current page = %s', pageRef.page)

      const col = getColumnCount()
      const leastCount = Math.ceil(items.length / col) * col + 1 // 至少换行, 不换行 infinite-scroll 有问题

      let newItems = items
      while (newItems.length < leastCount) {
        const more = await getRecommendTimes(2, pageRef)
        newItems = uniqConcat(newItems, more)
      }

      debug('fetchMore: len %s -> %s', items.length, newItems.length)
      setItems(newItems)
    })

    // 窄屏模式
    const { useNarrowMode } = useSettingsSnapshot()

    // .video-grid
    const containerRef = useRef<HTMLDivElement>(null)

    const getScrollerRect = useMemoizedFn(() => {
      // use window
      if (infiteScrollUseWindow) {
        const headerHight = HEADER_HEIGHT + 50 // 50 RecHeader height
        return new DOMRect(0, headerHight, window.innerWidth, window.innerHeight - headerHight)
      }
      // use in a scroller
      else {
        return scrollerRef?.current?.getBoundingClientRect()
      }
    })

    // 不喜欢弹框
    const modalDislikeVisible = useModalDislikeVisible()

    const videoCardRefs = useMemo(() => {
      return new Array<VideoCardActions | undefined | null>(items.length).fill(undefined)
    }, [items.length])

    // 快捷键
    const { activeIndex, clearActiveIndex } = useShortcut({
      enabled: shortcutEnabled && !modalDislikeVisible,
      refresh,
      maxIndex: items.length - 1,
      containerRef,
      getScrollerRect,
      videoCardRefs,
      changeScrollY: infiteScrollUseWindow
        ? function ({ offset, absolute }) {
            const scroller = document.documentElement
            if (typeof offset === 'number') {
              scroller.scrollTop += offset
              return
            }
            if (typeof absolute === 'number') {
              scroller.scrollTop = absolute
              return
            }
          }
        : undefined,
    })

    const isInisInternalTesting = getIsInternalTesting()

    return (
      <InfiniteScroll
        pageStart={0}
        hasMore={!isRefreshing}
        loadMore={fetchMore}
        initialLoad={false}
        useWindow={infiteScrollUseWindow}
        threshold={window.innerHeight} // 一屏
        style={{ minHeight: '100%' }}
        loader={
          <div className={cls.loader} key={-1}>
            加载中...
          </div>
        }
      >
        {/* 这里只定义列数, 宽度 100% */}
        <div
          ref={containerRef}
          className={cx(
            videoGrid,
            { [internalTesting]: isInisInternalTesting },
            { [narrowMode]: useNarrowMode },
            className
          )}
        >
          {isRefreshing
            ? //skeleton loading
              new Array(24).fill(undefined).map((_, index) => {
                return <VideoCard key={index} loading={true} className={cx(cls.card)} />
              })
            : // items
              items.map((item, index) => {
                const active = index === activeIndex
                return (
                  <VideoCard
                    ref={(val) => (videoCardRefs[index] = val)}
                    key={item.uniqId}
                    className={cx(cls.card, { [cls.cardActive]: active })}
                    item={item}
                    active={active}
                  />
                )
              })}
        </div>
      </InfiniteScroll>
    )
  }
)
