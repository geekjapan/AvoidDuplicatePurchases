export declare const VIDEO_GRAPHQL_URL = "https://api.video.dmm.co.jp/graphql";
export declare const VIDEO_PURCHASED_QUERY = "query PurchasedContent($offset:Int!,$limit:Int!,$filter:PPVContentViewingRightsItemSummaryListFilterInput!,$sort:PPVContentViewingRightsItemSummaryListSort!){\n  user{... on Member{ppvLibrary{contentViewingRightsSummaryList(filter:$filter,offset:$offset,limit:$limit,sort:$sort){\n    pageInfo{hasNext totalCount}\n    items{ id content{ id title floor contentType isDiscontinued } contentItem{ latestViewingRightsAcquiredAt } }\n  }}}}}";
export declare function videoPurchasedGraphqlBody(offset: number, limit: number): {
    operationName: string;
    query: string;
    variables: {
        offset: number;
        limit: number;
        filter: {
            displayStatus: string;
        };
        sort: string;
    };
};
//# sourceMappingURL=urls.d.ts.map