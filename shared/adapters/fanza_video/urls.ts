export const VIDEO_GRAPHQL_URL = "https://api.video.dmm.co.jp/graphql";

export const VIDEO_PURCHASED_QUERY = `query PurchasedContent($offset:Int!,$limit:Int!,$filter:PPVContentViewingRightsItemSummaryListFilterInput!,$sort:PPVContentViewingRightsItemSummaryListSort!){
  user{... on Member{ppvLibrary{contentViewingRightsSummaryList(filter:$filter,offset:$offset,limit:$limit,sort:$sort){
    pageInfo{hasNext totalCount}
    items{ id content{ id title floor contentType isDiscontinued } contentItem{ latestViewingRightsAcquiredAt } }
  }}}}}`;

export function videoPurchasedGraphqlBody(offset: number, limit: number): {
  operationName: string;
  query: string;
  variables: {
    offset: number;
    limit: number;
    filter: { displayStatus: string };
    sort: string;
  };
} {
  return {
    operationName: "PurchasedContent",
    query: VIDEO_PURCHASED_QUERY,
    variables: {
      offset,
      limit,
      filter: { displayStatus: "VISIBLE" },
      sort: "VIEWING_RIGHTS_ACQUIRED_AT_DESC",
    },
  };
}
