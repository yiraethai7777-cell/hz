"use strict";

const { getPool } = require("./hz-db");
const { ensureWallet } = require("./hz-wallet");
const { isMember } = require("./hz-members");

const MAX_QTY = 100000;

async function initTrading() {
  const db = getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS hz_stock_holdings (
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      stock_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      total_cost BIGINT NOT NULL CHECK (total_cost >= 0),
      PRIMARY KEY (room_id, user_id, symbol)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS hz_stock_trades (
      id BIGSERIAL PRIMARY KEY,
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      stock_name TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      price_krw BIGINT NOT NULL CHECK (price_krw > 0),
      total_krw BIGINT NOT NULL CHECK (total_krw > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log("[HZ 주식] 거래 테이블 준비 완료");
}

function validQuantity(value) {
  const qty = Number(value);

  if (!Number.isSafeInteger(qty) || qty < 1 || qty > MAX_QTY) {
    throw new Error("수량은 1~100,000 사이의 정수여야 합니다.");
  }

  return qty;
}

async function tradeStock({
  roomId, userId, userName,
  symbol, stockName, side,
  quantity, priceKrw
}) {
  const qty = validQuantity(quantity);

  if (!["BUY", "SELL"].includes(side)) {
    throw new Error("거래 종류가 올바르지 않습니다.");
  }

  if (!Number.isSafeInteger(priceKrw) || priceKrw <= 0) {
    throw new Error("주식 가격이 올바르지 않습니다.");
  }

  const total = priceKrw * qty;

  if (!Number.isSafeInteger(total)) {
    throw new Error("거래 금액이 너무 큽니다.");
  }

  const db = await getPool().connect();

  try {
    await db.query("BEGIN");

    if (!await isMember(roomId,userId,db)) throw new Error("❌ 게임 가입이 필요합니다. !게임가입을 입력해 주세요.");
    await ensureWallet(db,roomId,userId,userName);

    const wallet = await db.query(`
      SELECT balance FROM hz_wallets
      WHERE room_id = $1 AND user_id = $2
      FOR UPDATE
    `, [roomId, userId]);

    const balance = Number(wallet.rows[0].balance);

    if (side === "BUY") {
      if (balance < total) {
        throw new Error(
          "코인이 부족합니다.\n필요: " +
          total.toLocaleString("ko-KR") + "코인"
        );
      }

      await db.query(`
        UPDATE hz_wallets
        SET balance = balance - $3
        WHERE room_id = $1 AND user_id = $2
      `, [roomId, userId, total]);

      await db.query(`
        INSERT INTO hz_stock_holdings
          (room_id, user_id, symbol, stock_name, quantity, total_cost)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (room_id, user_id, symbol)
        DO UPDATE SET
          quantity = hz_stock_holdings.quantity + EXCLUDED.quantity,
          total_cost = hz_stock_holdings.total_cost + EXCLUDED.total_cost,
          stock_name = EXCLUDED.stock_name
      `, [roomId, userId, symbol, stockName, qty, total]);

    } else {
      const holding = await db.query(`
        SELECT quantity, total_cost
        FROM hz_stock_holdings
        WHERE room_id = $1 AND user_id = $2 AND symbol = $3
        FOR UPDATE
      `, [roomId, userId, symbol]);

      if (!holding.rowCount ||
          holding.rows[0].quantity < qty) {
        throw new Error("보유 주식 수량이 부족합니다.");
      }

      const owned = holding.rows[0].quantity;
      const cost = Number(holding.rows[0].total_cost);
      const remaining = owned - qty;

      if (remaining === 0) {
        await db.query(`
          DELETE FROM hz_stock_holdings
          WHERE room_id = $1 AND user_id = $2 AND symbol = $3
        `, [roomId, userId, symbol]);
      } else {
        const remainingCost = Math.round(cost * remaining / owned);

        await db.query(`
          UPDATE hz_stock_holdings
          SET quantity = $4, total_cost = $5
          WHERE room_id = $1 AND user_id = $2 AND symbol = $3
        `, [roomId, userId, symbol, remaining, remainingCost]);
      }

      await db.query(`
        UPDATE hz_wallets
        SET balance = balance + $3
        WHERE room_id = $1 AND user_id = $2
      `, [roomId, userId, total]);
    }

    await db.query(`
      INSERT INTO hz_stock_trades
        (room_id, user_id, symbol, stock_name,
         side, quantity, price_krw, total_krw)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [roomId, userId, symbol, stockName,
        side, qty, priceKrw, total]);

    await db.query(`
      INSERT INTO hz_coin_logs
        (room_id, user_id, type, amount, detail)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      roomId, userId,
      side === "BUY" ? "STOCK_BUY" : "STOCK_SELL",
      side === "BUY" ? -total : total,
      symbol + " " + qty + "주"
    ]);

    await db.query("COMMIT");

    return {
      side, symbol, stockName, quantity: qty,
      priceKrw, total,
      balance: balance + (side === "BUY" ? -total : total)
    };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
}

async function getHoldings(roomId, userId) {
  const result = await getPool().query(`
    SELECT symbol, stock_name, quantity, total_cost
    FROM hz_stock_holdings
    WHERE room_id = $1 AND user_id = $2
    ORDER BY stock_name
  `, [roomId, userId]);

  return result.rows;
}

async function getTradeHistory(roomId, userId) {
  const result = await getPool().query(`
    SELECT stock_name, symbol, side, quantity,
           price_krw, total_krw, created_at
    FROM hz_stock_trades
    WHERE room_id = $1 AND user_id = $2
    ORDER BY id DESC
    LIMIT 20
  `, [roomId, userId]);

  return result.rows;
}

module.exports = {
  initTrading,
  tradeStock,
  getHoldings,
  getTradeHistory,
  validQuantity
};
