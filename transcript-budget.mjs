import {DatabaseSync} from 'node:sqlite';
import {chmodSync} from 'node:fs';

// Same local persistent file coordinates processes on one host, not separate disks.
export function createTranscriptBudget(path) {
  let memory = [];
  let db;
  return {
    reserve(time, check) {
      if (!path) { memory = memory.filter(t => t > time - 30 * 86400000); check(memory); memory.push(time); return; }
      try {
        if (!db) {
          db = new DatabaseSync(path);
          chmodSync(path, 0o600);
          db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS transcript_requests (time INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS transcript_request_time ON transcript_requests(time);');
        }
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('DELETE FROM transcript_requests WHERE time<=?').run(time - 30 * 86400000);
          check(db.prepare('SELECT time FROM transcript_requests ORDER BY time').all().map(r => r.time));
          db.prepare('INSERT INTO transcript_requests VALUES (?)').run(time);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      } catch (error) {
        if (error.status) throw error;
        throw Object.assign(Error('자막 사용량 저장소를 확인할 수 없어 새 요청을 중지했습니다. 관리자에게 문의해 주세요.'), {status:503,code:'API_BUDGET_UNAVAILABLE'});
      }
    },
    close() { db?.close(); db = undefined; }
  };
}
