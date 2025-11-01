import React from 'react'

// Page css
import './Parking.style.css'

const Parking = ({item}) => {

  const kakaoMapLink = `https://map.kakao.com/link/to/${item.parkingAddressID}`;
  const singleRightArrow = "/images/icon/rightSingleArrowIcon.png";

  return (
    <div>
        <div className="topParkingInfo">
          <div className="parkingInfoCover">
            <div className="parkingInfoIcon">
              <img src="/images/icon/parkingIcon.png" alt="parkingIcon" />
            </div>
            <div className="parkingInfoText">
              <p className='topParkingTableHead1'>주차 가능 여부</p>
              <p className='parkT'>{item.parking == true?"가능":"불가"}</p>
            </div>
          </div>
          <div className="parkingInfoCover">
            <div className="parkingInfoIcon">
              <img src="/images/icon/feeIcon.png" alt="feeIcon" />
            </div>
            <div className="parkingInfoText">
              <p className='topParkingTableHead2'>주차 비용 여부</p>
              <p className='parkT'>{item.parkingFee == true?"유료":"무료"}</p>
            </div>
          </div>
          <div className="parkingInfoCover">
            <div className="parkingInfoIcon">
              <img src="/images/icon/carIcon.png" alt="carIcon" />
            </div>
            <div className="parkingInfoText">
              <p className='parkP'><strong>추천 주차 주소</strong> <br/>
                <a href={item.parking == true?kakaoMapLink:"#"} target="_blank" rel="noopener noreferrer" className='parkA'>
                    {item.parking == true?(
                      <>
                        {item.parkingAddress+" "}
                        <img src={singleRightArrow} alt="singleRightArrow" />
                      </>
                    ):""}
                </a>
              </p>
            </div>
          </div>
        </div>
      <div className="emptyLine"></div>
    </div>
  )
}

export default Parking
