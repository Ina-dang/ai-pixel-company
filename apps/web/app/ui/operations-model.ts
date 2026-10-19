export type OperationsJob={id:string;kind:string;status:string;error_code:string|null;result:Record<string,unknown>|null;updated_at:string};
export type OperationsAlert={id:string;rule_key:string;severity:string;message_ko:string;status:string;version:number;opened_at:string};
export type OperationsState={checkedAt:string|null;collectionError:string|null;control:{paused:boolean;mode:string;reasonKo:string;version:number;maintenanceActive:boolean};
  snapshot:null|{checkedAt:string;dbResponseMs:number;runs:Record<string,number>;review:Record<string,number>;integrations:Record<string,number>;usage:{project_id:string;completed_tokens:string;unconfirmed_tokens:string}[];
    api:{samples:number;p95Ms:number|null;errors5xx:number;activeStreams:number;maxStreams:number;slowStreams:number};health:null|{provider:{ready:boolean;code:string|null};sandbox:{ready:boolean;code:string|null};workers:Record<string,{running:boolean;busy:boolean;lastTickAt:string|null}>};process:{rssBytes:number;uptimeSeconds:number}};
  alerts:OperationsAlert[];events:{id:string;alert_id:string;action:string;original_ko:string;created_at:string}[];
  backups:{id:string;sha256:string;bytes:string;captured_at:string;table_count:number;artifact_count:number}[];jobs:OperationsJob[];
  notifications:{id:string;status:string;attempts:number;error_code:string|null;external_ref:{channelId:string;timestamp:string}|null}[];
  notificationPolicy:{enabled:boolean;projectId:string|null;version:number};release:{profile:string;status:string;blockers:string[];checks:{name:string;status:string;checked_at:string}[];production:{status:string;blockers:string[];deploymentExecuted:boolean;mergeExecuted:boolean}}};
