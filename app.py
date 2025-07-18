# app.py
from flask import Flask, render_template, jsonify, request, redirect, url_for
import pandas as pd
from datetime import timedelta
import io # Import io module for in-memory file handling

app = Flask(__name__)

uploaded_dfs = {}  # key = IP address, value = DataFrame

# Moving average
def add_trendlines(data, window=5):
    # Ensure we're working on a copy to avoid SettingWithCopyWarning
    data_copy = data.copy()
    for col in data_copy.select_dtypes(include='number').columns:
        data_copy[f"{col}_trend"] = data_copy[col].rolling(window, min_periods=1).mean()
    return data_copy

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/upload_csv", methods=["POST"])
def upload_csv():
    ip = request.remote_addr

    if "csv_file" not in request.files:
        return "No file part", 400
    
    file = request.files["csv_file"]
    
    if file.filename == "":
        return "No selected file", 400
    
    if file and file.filename.endswith(".csv"):
        try:
            file_content = io.StringIO(file.read().decode('utf-8'))
            df = pd.read_csv(file_content)
            
            df.columns = [col.strip() for col in df.columns]

            if "Date" in df.columns and "Time" in df.columns:
                df["Timestamp"] = pd.to_datetime(df["Date"] + " " + df["Time"]).dt.tz_localize("Asia/Jakarta")
                df = df.drop(columns=["Date", "Time"], errors='ignore')
            elif "Timestamp" in df.columns:
                df["Timestamp"] = pd.to_datetime(df["Timestamp"])
            else:
                df["Timestamp"] = pd.to_datetime(pd.Series(range(len(df))), unit='s')
            
            cols = ['Timestamp'] + [col for col in df.columns if col != 'Timestamp']
            df = df[cols]

            uploaded_dfs[ip] = df  # Save per-IP
            return redirect(url_for("index"))
        except Exception as e:
            return f"Error processing CSV: {e}", 500
    else:
        return "Invalid file type. Please upload a CSV file.", 400



@app.route("/data")
def get_data():
    ip = request.remote_addr

    if ip not in uploaded_dfs:
        return jsonify({"error": "No CSV file has been uploaded yet."}), 400

    current_df = uploaded_dfs[ip].copy()

    time_range = request.args.get("time_range", "all")
    time_interval_str = request.args.get("time_interval", "0")
    num_segments_str = request.args.get("num_segments", "1")
    segment_index_str = request.args.get("segment_index", "0")

    time_interval = int(time_interval_str)
    num_segments = int(num_segments_str)
    segment_index = int(segment_index_str)

    df_processed = current_df

    if time_range != "all":
        if "Timestamp" not in df_processed.columns:
            return jsonify({"error": "Timestamp column not found for time range filtering."}), 400

        latest_timestamp = df_processed["Timestamp"].max()
        cutoff_timestamp = latest_timestamp

        if time_range == "1h":
            cutoff_timestamp = latest_timestamp - timedelta(hours=1)
        elif time_range == "6h":
            cutoff_timestamp = latest_timestamp - timedelta(hours=6)
        elif time_range == "12h":
            cutoff_timestamp = latest_timestamp - timedelta(hours=12)
        elif time_range == "1d":
            cutoff_timestamp = latest_timestamp - timedelta(days=1)
        elif time_range == "2d":
            cutoff_timestamp = latest_timestamp - timedelta(days=2)
        elif time_range == "7d":
            cutoff_timestamp = latest_timestamp - timedelta(days=7)
        elif time_range == "14d":
            cutoff_timestamp = latest_timestamp - timedelta(days=14)
        elif time_range == "30d":
            cutoff_timestamp = latest_timestamp - timedelta(days=30)

        df_processed = df_processed[df_processed["Timestamp"] >= cutoff_timestamp]
    else:
        # For "all" range, sample the data if it's too large for initial display
        # This is a coarse sampling for overview, actual resampling happens next if interval is set
        if len(df_processed) > 2000:
            step = len(df_processed) // 2000
            df_processed = df_processed.iloc[::step]

    # 2. Apply time interval resampling
    if time_interval > 0 and not df_processed.empty:
        if "Timestamp" not in df_processed.columns:
            return jsonify({"error": "Timestamp column not found for resampling."}), 400
        # Set Timestamp as index for resampling
        df_processed = df_processed.set_index('Timestamp')
        # Resample numeric columns, keep others (like Date/Time if they were still there, though they aren't now)
        numeric_cols = df_processed.select_dtypes(include='number').columns
        df_resampled = df_processed[numeric_cols].resample(f'{time_interval}S').mean()
        df_processed = df_resampled.reset_index()
        # Fill any NaN values that might result from resampling (e.g., if no data in an interval)
        df_processed = df_processed.fillna(method='ffill').fillna(method='bfill')


    # 3. Apply data splitting (segmentation)
    if num_segments > 1 and not df_processed.empty:
        total_rows = len(df_processed)
        rows_per_segment = total_rows // num_segments
        
        start_index = segment_index * rows_per_segment
        end_index = start_index + rows_per_segment
        
        # Adjust end_index for the last segment to include remaining rows
        if segment_index == num_segments - 1:
            end_index = total_rows
            
        df_processed = df_processed.iloc[start_index:end_index]

    # 4. Add trendlines to the final processed data
    data_with_trendlines = add_trendlines(df_processed)

    return jsonify(data_with_trendlines.to_dict(orient="records"))

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)


