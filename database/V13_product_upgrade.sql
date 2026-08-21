-- Live Coders V13: server-side automatic interest signals.
-- Optional but recommended for cross-device feed personalization.

create table if not exists public.user_interest_signals (
  user_id uuid not null references auth.users(id) on delete cascade,
  signal_type text not null,
  signal_value text not null,
  score integer not null default 0,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, signal_type, signal_value)
);

create index if not exists user_interest_signals_user_score_idx
  on public.user_interest_signals(user_id, score desc, last_seen_at desc);

alter table public.user_interest_signals enable row level security;

drop policy if exists interest_select_own on public.user_interest_signals;
create policy interest_select_own on public.user_interest_signals
for select to authenticated using (user_id = auth.uid());

create or replace function public.record_interest_signal(
  signal_type_input text,
  signal_value_input text,
  weight_input integer default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if coalesce(trim(signal_type_input),'') = '' or coalesce(trim(signal_value_input),'') = '' then
    return;
  end if;

  insert into public.user_interest_signals(user_id,signal_type,signal_value,score,last_seen_at)
  values(auth.uid(),lower(trim(signal_type_input)),lower(trim(signal_value_input)),greatest(1,least(coalesce(weight_input,1),10)),now())
  on conflict(user_id,signal_type,signal_value)
  do update set
    score = least(1000, public.user_interest_signals.score + greatest(1,least(coalesce(weight_input,1),10))),
    last_seen_at = now();
end;
$$;

grant execute on function public.record_interest_signal(text,text,integer) to authenticated;

-- Keep this table limited to product interaction signals. It is not intended
-- to store sensitive personal or health inferences.
