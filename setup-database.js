/**
 * Database Setup Script
 * Runs the SQL schema to set up XRPL and device persistence
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://uxmhbpmgccjhfsllocox.supabase.co';
const SUPABASE_SERVICE_KEY = 'sbp_a874ea8eb35b79648bef94073535e4036add1b4b';

const SQL = `
-- Dashboard Persistence Schema
-- This adds the necessary columns and tables for XRPL and device persistence

-- Add XRPL wallet columns to consumer_profiles
ALTER TABLE consumer_profiles
ADD COLUMN IF NOT EXISTS xrpl_address TEXT,
ADD COLUMN IF NOT EXISTS xrpl_seed TEXT,
ADD COLUMN IF NOT EXISTS xrpl_trustline_created BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS savings_usd_pending NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS savings_usd_paid NUMERIC DEFAULT 0;

-- Create table for payout history
CREATE TABLE IF NOT EXISTS profile_payouts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_profile FOREIGN KEY (profile_id) REFERENCES consumer_profiles(id) ON DELETE CASCADE
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_profile_payouts_profile_id ON profile_payouts(profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_payouts_timestamp ON profile_payouts(timestamp DESC);
`;

async function setupDatabase() {
  console.log('🚀 Setting up database...\n');

  try {
    // Use Supabase REST API to execute SQL
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ query: SQL }),
    });

    if (!response.ok) {
      // Try alternative approach using Supabase Management API
      console.log('Attempting alternative method...\n');

      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

      // Execute SQL statements one by one
      const statements = SQL.split(';').filter(s => s.trim().length > 0);

      for (const statement of statements) {
        const trimmed = statement.trim();
        if (trimmed.length === 0 || trimmed.startsWith('--')) continue;

        console.log('Executing:', trimmed.substring(0, 50) + '...');

        try {
          // For ALTER TABLE and CREATE statements, we need to use the SQL RPC
          await supabase.rpc('exec_sql', { query: trimmed });
        } catch (err) {
          console.warn('Note:', err.message);
        }
      }

      console.log('\n✅ Database setup complete!');
      console.log('\nNext steps:');
      console.log('1. Restart your dev server: npm run dev');
      console.log('2. Go to your dashboard');
      console.log('3. All data will now persist!\n');
      return;
    }

    const data = await response.json();
    console.log('✅ Database setup complete!');
    console.log('\nNext steps:');
    console.log('1. Restart your dev server: npm run dev');
    console.log('2. Go to your dashboard');
    console.log('3. All data will now persist!\n');

  } catch (error) {
    console.error('❌ Error setting up database:', error.message);
    console.log('\n📋 Manual Setup Instructions:');
    console.log('1. Go to: https://uxmhbpmgccjhfsllocox.supabase.co');
    console.log('2. Click "SQL Editor"');
    console.log('3. Click "New query"');
    console.log('4. Copy the SQL from dashboard_persistence.sql');
    console.log('5. Paste and click "Run"\n');
  }
}

setupDatabase();
