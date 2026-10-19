import postgres from 'postgres';
import { loadRuntime } from './runtime.js';

const sql = postgres(loadRuntime().databaseUrl, { max: 1 });
try {
  const databases = await sql`select 1 from pg_database where datname = 'pixel_company_test'`;
  if (!databases.length) await sql.unsafe('create database pixel_company_test');
  console.log('전용 테스트 데이터베이스 준비 완료');
} finally {
  await sql.end();
}
