import React from 'react'

// Kakao Map API Import
import { Map, MapMarker,useKakaoLoader } from 'react-kakao-maps-sdk';

// Page css
import './Explain.style.css'

const Explain = ({item}) => {

    // Kakao Map Script Load
    useKakaoLoader()
    
    // item.latLng가 "lat,lng" 문자열일 경우 숫자로 변환
    const [lat, lng] = item.latLng.split(',').map(Number);
    const kakaoMapLink = `https://map.kakao.com/link/to/${item.placeID}`;
  return (
    <div>
      <div className='explainCover'>
        <div className="explainTextCover">
          <h1 className="explainTitle">{item.explainTitle}</h1>
          <p className="explain">{item.explain}</p>
          <p className="explainLast">{item.explainLast}</p>
        </div>
        <Map
            id="map"
            className='topMap'
            center={{ lat: lat, lng: lng }}
            level={3} // 지도 확대 레벨
        >
            <MapMarker position={{ lat: lat, lng: lng }} />
        </Map>
        <div className="topaLinkCover">
            <a href={kakaoMapLink} target="_blank" rel="noopener noreferrer" className='topA'>
                <br/>길찾기
            </a>
        </div>
      </div>
      <div className="emptyLine"></div>
    </div>
  )
}

export default Explain
