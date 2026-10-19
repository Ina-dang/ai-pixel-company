import type {Database,Transaction} from '@ai-pixel/db';
import {ApiError} from './security.js';

export async function maintenanceReason(sql:Database['sql']|Transaction){
  const rows=await sql`select mode,paused from operations_controls where paused=true or mode<>'LIVE' limit 1`;
  return rows[0]?(rows[0].mode==='RESTORE_QUARANTINE'?'RESTORE_QUARANTINE':'MAINTENANCE_PAUSED'):null;
}
export async function assertOperationsLive(sql:Database['sql']|Transaction){
  const reason=await maintenanceReason(sql);if(reason)throw new ApiError(503,reason,'운영 점검 또는 복원 격리 중이라 실행·외부 전송을 중단했습니다.');
}
