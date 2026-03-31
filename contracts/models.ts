export type ActivityStatus = "safe" | "unsafe" | "error";

export interface Post {
  title: string;
  author: string;
  date: string;
  views: number;
  isNotice: boolean;
}

export interface ActivityLog {
  timestamp: string;
  current_gap_count: number;
  last_post_timestamp: string;
  top_competitor_names: string[];
  view_count_of_last_post: number;
  status: ActivityStatus;
  all_posts: Post[];
  error?: string;
}

export interface BoardStats {
  turnoverRate: number | string;
  shareOfVoice: number;
}

export interface CompetitorStat {
  author: string;
  frequency: number;
  avgViews: number;
}

export interface DraftItem {
  title: string;
  timestamp: string;
  id: string;
}
