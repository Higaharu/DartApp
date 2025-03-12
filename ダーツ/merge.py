import os
import pandas as pd
import glob
from datetime import datetime
import sys
import re

def extract_timestamp_from_filename(filename):
    """ファイル名からタイムスタンプ部分を抽出する"""
    # 日付と時間の部分を抽出するパターン
    # 20250304_163722 のような形式を検出
    patterns = [
        r'(\d{8}_\d{6})',  # 20250304_163722
        r'(\d{4}\.\d{1,2}\.\d{1,2}_\d{2}\d{2}\d{2})',  # 2025.3.4_163722
        r'(\d{1,2}-\d{1,2}-\d{4}_\d{2}\d{2}\d{2})',  # 3-4-2025_163722
    ]
    
    base_name = os.path.basename(filename)
    for pattern in patterns:
        match = re.search(pattern, base_name)
        if match:
            return match.group(1)
    
    # パターンに一致しない場合はファイル名全体を返す
    return os.path.splitext(base_name)[0]

def find_matching_files(muscle_files, angle_files):
    """筋変位ファイルと角度ファイルのマッチングペアを見つける"""
    matches = []
    unmatched_muscle = []
    
    # 筋変位ファイルと角度ファイルからタイムスタンプ情報を抽出
    muscle_timestamps = {extract_timestamp_from_filename(f): f for f in muscle_files}
    angle_timestamps = {extract_timestamp_from_filename(f): f for f in angle_files}
    
    print("\n抽出されたタイムスタンプ:")
    print("筋変位ファイル:")
    for ts, f in muscle_timestamps.items():
        print(f"  {os.path.basename(f)} -> {ts}")
    
    print("角度ファイル:")
    for ts, f in angle_timestamps.items():
        print(f"  {os.path.basename(f)} -> {ts}")
    
    # 時間情報が完全一致するファイルを探す
    for muscle_ts, muscle_file in muscle_timestamps.items():
        matched = False
        
        # 完全一致
        if muscle_ts in angle_timestamps:
            matches.append((muscle_file, angle_timestamps[muscle_ts]))
            matched = True
        else:
            # 部分一致を試みる
            for angle_ts, angle_file in angle_timestamps.items():
                # どちらかに他方が含まれている場合
                if muscle_ts in angle_ts or angle_ts in muscle_ts:
                    matches.append((muscle_file, angle_file))
                    matched = True
                    break
            
            # それでもマッチしない場合は、日付部分だけで一致を試みる
            if not matched:
                muscle_date = muscle_ts.split('_')[0] if '_' in muscle_ts else muscle_ts
                for angle_ts, angle_file in angle_timestamps.items():
                    angle_date = angle_ts.split('_')[0] if '_' in angle_ts else angle_ts
                    if muscle_date == angle_date:
                        matches.append((muscle_file, angle_file))
                        matched = True
                        break
        
        if not matched:
            unmatched_muscle.append(muscle_file)
    
    return matches, unmatched_muscle

def merge_muscle_angle_data(muscle_file, angle_file, output_file=None):
    """
    筋変位データと角度データをタイムスタンプに基づいて結合する関数
    
    Parameters:
    -----------
    muscle_file : str
        筋変位データのCSVファイルパス
    angle_file : str
        角度データのCSVファイルパス
    output_file : str, optional
        出力ファイルパス（指定しない場合は結合データを返すのみ）
    
    Returns:
    --------
    pandas.DataFrame
        結合されたデータフレーム
    """
    # デバッグ情報
    print(f"筋変位ファイル: {os.path.basename(muscle_file)}")
    print(f"角度ファイル: {os.path.basename(angle_file)}")
    
    # CSVファイルを読み込む
    try:
        muscle_df = pd.read_csv(muscle_file)
        print(f"筋変位データ読み込み成功: {len(muscle_df)}行")
    except Exception as e:
        print(f"筋変位データ読み込みエラー: {str(e)}")
        return None
    
    try:
        angle_df = pd.read_csv(angle_file)
        print(f"角度データ読み込み成功: {len(angle_df)}行")
    except Exception as e:
        print(f"角度データ読み込みエラー: {str(e)}")
        return None
    
    # タイムスタンプをdatetime型に変換
    # 列名を確認（異なる可能性がある）
    timestamp_cols = {
        'muscle': next((col for col in muscle_df.columns if 'time' in col.lower() or 'stamp' in col.lower()), None),
        'angle': next((col for col in angle_df.columns if 'time' in col.lower() or 'stamp' in col.lower()), None)
    }
    
    if not timestamp_cols['muscle']:
        print(f"警告: 筋変位データにタイムスタンプ列が見つかりません: {muscle_df.columns.tolist()}")
        if 'Timestamp' in muscle_df.columns:
            timestamp_cols['muscle'] = 'Timestamp'
        else:
            print("エラー: 筋変位データにタイムスタンプ列が見つかりません。処理を中止します。")
            return None
    
    if not timestamp_cols['angle']:
        print(f"警告: 角度データにタイムスタンプ列が見つかりません: {angle_df.columns.tolist()}")
        if 'timestamp' in angle_df.columns:
            timestamp_cols['angle'] = 'timestamp'
        else:
            print("エラー: 角度データにタイムスタンプ列が見つかりません。処理を中止します。")
            return None
    
    print(f"使用するタイムスタンプ列 - 筋変位: {timestamp_cols['muscle']}, 角度: {timestamp_cols['angle']}")
    
    try:
        muscle_df['datetime'] = pd.to_datetime(muscle_df[timestamp_cols['muscle']])
        angle_df['datetime'] = pd.to_datetime(angle_df[timestamp_cols['angle']])
        print("タイムスタンプ変換成功")
    except Exception as e:
        print(f"タイムスタンプ変換エラー: {str(e)}")
        # タイムスタンプの形式を確認
        print(f"筋変位タイムスタンプサンプル: {muscle_df[timestamp_cols['muscle']].iloc[0]}")
        print(f"角度タイムスタンプサンプル: {angle_df[timestamp_cols['angle']].iloc[0]}")
        return None
    
    # データの先頭を表示（デバッグ用）
    print("筋変位データ先頭:")
    print(muscle_df.head(2))
    print("角度データ先頭:")
    print(angle_df.head(2))
    
    # 筋変位データのタイムスタンプが秒単位なので、理論上の小数点部分を追加
    # 22Hzなので約45.45msごとのサンプリング
    print("筋変位データにミリ秒情報を追加中...")
    prev_second = None
    count_in_second = 0
    for i in range(len(muscle_df)):
        current_time = muscle_df['datetime'].iloc[i]
        current_second = (current_time.hour, current_time.minute, current_time.second)
        
        if prev_second is not None and current_second == prev_second:
            # 同じ秒内のデータ
            count_in_second += 1
        else:
            # 新しい秒に入った
            count_in_second = 0
            prev_second = current_second
        
        # 22Hzでのミリ秒を計算
        milliseconds = int((count_in_second * (1000 / 22)) % 1000)
        muscle_df.at[i, 'datetime'] = muscle_df['datetime'].iloc[i].replace(microsecond=milliseconds * 1000)
    
    # 最初のレコードの時間差を計算し、オフセットを決定
    first_muscle_time = muscle_df['datetime'].iloc[0]
    first_angle_time = angle_df['datetime'].iloc[0]
    time_offset = (first_muscle_time - first_angle_time).total_seconds()
    
    print(f"初期時間差: {time_offset}秒")
    
    # データをコピーして結合準備
    muscle_df_copy = muscle_df.copy()
    angle_df_copy = angle_df.copy()
    
    # 必要に応じて時間調整
    if abs(time_offset) > 1:  # 時間差が大きい場合は調整
        print(f"時間オフセットを調整: {time_offset}秒")
        # 時間のオフセットを補正
        if time_offset > 0:
            muscle_df_copy['merge_key'] = muscle_df_copy['datetime'] - pd.Timedelta(seconds=round(time_offset))
            angle_df_copy['merge_key'] = angle_df_copy['datetime']
        else:
            muscle_df_copy['merge_key'] = muscle_df_copy['datetime']
            angle_df_copy['merge_key'] = angle_df_copy['datetime'] - pd.Timedelta(seconds=round(-time_offset))
    else:
        muscle_df_copy['merge_key'] = muscle_df_copy['datetime']
        angle_df_copy['merge_key'] = angle_df_copy['datetime']
    
    # merge_asofを使用して最も近い時間のデータどうしを結合
    print("データ結合中...")
    try:
        # 結合前にソート
        muscle_df_copy = muscle_df_copy.sort_values('merge_key')
        angle_df_copy = angle_df_copy.sort_values('merge_key')
        
        # 結合実行
        merged_df = pd.merge_asof(
            muscle_df_copy,
            angle_df_copy,
            on='merge_key',
            direction='nearest'
        )
        
        print(f"結合成功: {len(merged_df)}行")
    except Exception as e:
        print(f"結合エラー: {str(e)}")
        return None
    
    # 不要な列を削除
    columns_to_drop = ['merge_key', 'datetime_x', 'datetime_y']
    for col in columns_to_drop:
        if col in merged_df.columns:
            merged_df = merged_df.drop(col, axis=1)
    
    # 結果を出力
    if output_file:
        try:
            # 出力フォルダが存在するか確認
            output_dir = os.path.dirname(output_file)
            if not os.path.exists(output_dir):
                os.makedirs(output_dir)
                print(f"出力フォルダを作成しました: {output_dir}")
            
            merged_df.to_csv(output_file, index=False)
            print(f"結合データを保存しました: {output_file}")
        except Exception as e:
            print(f"ファイル保存エラー: {str(e)}")
    
    return merged_df

def find_csv_files(directory):
    """指定されたディレクトリ内のすべてのCSVファイルを検索"""
    print(f"ディレクトリ {directory} のCSVファイルを検索中...")
    if not os.path.exists(directory):
        print(f"ディレクトリが存在しません: {directory}")
        return []
    
    csv_files = glob.glob(os.path.join(directory, "*.csv"))
    if not csv_files:
        # サブフォルダも検索
        for root, dirs, files in os.walk(directory):
            for file in files:
                if file.endswith('.csv'):
                    csv_files.append(os.path.join(root, file))
    
    print(f"{len(csv_files)}個のCSVファイルが見つかりました")
    return csv_files

def process_all_files(muscle_folder, angle_folder, output_folder):
    """
    指定されたフォルダ内のすべてのマッチングするファイルを処理
    
    Parameters:
    -----------
    muscle_folder : str
        筋変位データが含まれるフォルダパス
    angle_folder : str
        角度データが含まれるフォルダパス
    output_folder : str
        結合データの出力先フォルダパス
    """
    # 筋変位データフォルダのCSVファイルを取得
    muscle_files = find_csv_files(muscle_folder)
    
    if not muscle_files:
        print("筋変位データファイルが見つかりません。フォルダパスを確認してください。")
        print(f"現在のフォルダ: {os.getcwd()}")
        print(f"筋変位フォルダパス: {muscle_folder}")
        return
    
    # ファイル名パターンの確認
    print("筋変位ファイル一覧:")
    for f in muscle_files:
        print(f"  {os.path.basename(f)}")
    
    # 角度データフォルダのCSVファイルを取得
    angle_files = find_csv_files(angle_folder)
    
    if not angle_files:
        print("角度データファイルが見つかりません。フォルダパスを確認してください。")
        print(f"角度フォルダパス: {angle_folder}")
        return
    
    print("角度ファイル一覧:")
    for f in angle_files:
        print(f"  {os.path.basename(f)}")
    
    # 出力フォルダを作成
    if not os.path.exists(output_folder):
        try:
            os.makedirs(output_folder)
            print(f"出力フォルダを作成しました: {output_folder}")
        except Exception as e:
            print(f"出力フォルダの作成に失敗しました: {str(e)}")
            return
    
    # マッチングするファイルペアを見つける
    file_pairs, unmatched = find_matching_files(muscle_files, angle_files)
    
    print(f"\n{len(file_pairs)}組のマッチングファイルが見つかりました")
    print(f"{len(unmatched)}個の筋変位ファイルはマッチするものが見つかりませんでした")
    
    if not file_pairs:
        print("マッチするファイルペアが見つかりませんでした。処理を中止します。")
        
        # インタラクティブなファイル選択を提供
        print("\n手動でファイルをマッチングします。")
        print("筋変位ファイルを選択してください:")
        for i, f in enumerate(muscle_files):
            print(f"  [{i}] {os.path.basename(f)}")
        
        print("\n角度ファイルを選択してください:")
        for i, f in enumerate(angle_files):
            print(f"  [{i}] {os.path.basename(f)}")
        
        print("\n手動で筋変位ファイルと角度ファイルの番号を入力してペアにできます。")
        print("例: '0 1' と入力すると、筋変位ファイル[0]と角度ファイル[1]をペアにします。")
        print("処理を終了するには 'q' を入力してください。")
        
        # 注：実際の対話処理はここで実装できません。コード内のコメントとして残します。
        # この部分はスクリプト実行時に手動で行う必要があります。
        return
    
    # 各ファイルペアを処理
    processed_count = 0
    for muscle_file, angle_file in file_pairs:
        # 出力ファイル名を生成
        muscle_basename = os.path.splitext(os.path.basename(muscle_file))[0]
        angle_basename = os.path.splitext(os.path.basename(angle_file))[0]
        output_basename = f"{muscle_basename}_merged_with_{angle_basename}.csv"
        output_file = os.path.join(output_folder, output_basename)
        
        print(f"\n処理中: {os.path.basename(muscle_file)} と {os.path.basename(angle_file)}")
        
        # ファイルの結合を実行
        try:
            merge_result = merge_muscle_angle_data(muscle_file, angle_file, output_file)
            if merge_result is not None:
                print(f"成功: {output_file} に保存しました")
                processed_count += 1
            else:
                print(f"警告: {os.path.basename(muscle_file)} の処理に失敗しました")
        except Exception as e:
            print(f"エラー: {os.path.basename(muscle_file)} の処理中に例外が発生しました - {str(e)}")
    
    print(f"\n処理完了: {processed_count}個のファイルが結合されました")
    if unmatched:
        print("\nマッチしなかった筋変位ファイル:")
        for f in unmatched:
            print(f"  {os.path.basename(f)}")

# メイン実行部分
if __name__ == "__main__":
    print("データ結合スクリプトを開始します")
    print(f"現在の作業ディレクトリ: {os.getcwd()}")
    print(f"Pythonバージョン: {sys.version}")
    
    # フォルダパスを設定（相対パスと絶対パスの両方を試す）
    home_dir = os.path.expanduser("~")
    possible_base_dirs = [
        os.path.join(home_dir, "k248578/ダーツ"),
        os.path.join(home_dir, "k248578/ダーツ"),
        "./ダーツ",
        "."
    ]
    
    # 実際に存在するベースディレクトリを選択
    base_dir = next((d for d in possible_base_dirs if os.path.exists(d)), possible_base_dirs[-1])
    print(f"使用するベースディレクトリ: {base_dir}")
    
    # サブフォルダを探す（フォルダ名のバリエーションを試す）
    possible_muscle_folders = [
        os.path.join(base_dir, "2025.3.4_muscle/ダーツ投げ"),
        os.path.join(base_dir, "muscle"),
        os.path.join(base_dir)
    ]
    
    possible_angle_folders = [
        os.path.join(base_dir, "2025.3.4_angle/ダーツ投げ"),
        os.path.join(base_dir, "angle"),
        os.path.join(base_dir)
    ]
    
    # 実際に存在するフォルダを選択
    muscle_folder = next((f for f in possible_muscle_folders if os.path.exists(f)), possible_muscle_folders[0])
    angle_folder = next((f for f in possible_angle_folders if os.path.exists(f)), possible_angle_folders[0])
    
    print(f"筋変位データフォルダ: {muscle_folder}")
    print(f"角度データフォルダ: {angle_folder}")
    
    # 出力フォルダを設定
    output_folder = os.path.join(base_dir, "merged_data")
    print(f"出力フォルダ: {output_folder}")
    
    # すべてのファイルを処理
    process_all_files(muscle_folder, angle_folder, output_folder)
    
    print("\nスクリプト実行完了")